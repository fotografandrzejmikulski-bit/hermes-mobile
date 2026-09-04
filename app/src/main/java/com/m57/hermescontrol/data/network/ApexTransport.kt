package com.m57.hermescontrol.data.network

import com.m57.hermescontrol.data.ai.PolishSystemPrompt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.io.IOException
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.TimeUnit

/**
 * REST/SSE fallback transport for gateways where the WebSocket TUI channel is
 * unavailable. It is deliberately independent from the existing WS singleton
 * so the caller can use it as a failover without disturbing the primary link.
 */
class ApexRestSseTransport(
    private val httpClient: OkHttpClient,
) {
    data class Config(
        val baseUrl: String,
        val token: String? = null,
        val connectTimeoutMs: Long = 5_000L,
        val readTimeoutMs: Long = 0L,
    )

    data class StreamDelta(
        val messageId: String,
        val text: String,
        val raw: String? = null,
    )

    fun streamChat(
        config: Config,
        sessionId: String,
        prompt: String,
    ): Flow<StreamDelta> = flow {
        val normalizedBase = config.baseUrl.trimEnd('/')
        val requestId = UUID.randomUUID().toString()
        val json = buildJsonPayload(sessionId, prompt)
        val request = Request.Builder()
            .url("$normalizedBase/v1/chat/completions")
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .header("X-Request-ID", requestId)
            .apply {
                config.token?.takeIf { it.isNotBlank() }?.let {
                    header("Authorization", "Bearer $it")
                    header("X-API-Key", it)
                }
            }
            .post(json.toRequestBody(JSON_MEDIA_TYPE))
            .build()

        val terminal = AtomicBoolean(false)
        val failure = AtomicReference<Throwable?>(null)
        val sourceRef = AtomicReference<EventSource?>(null)

        val listener = object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: okhttp3.Response) {
                sourceRef.set(eventSource)
                if (!response.isSuccessful) {
                    failure.set(IOException("HTTP ${response.code}"))
                    terminal.set(true)
                }
            }

            override fun onEvent(
                eventSource: EventSource,
                id: String?,
                type: String?,
                data: String,
            ) {
                if (data == "[DONE]") {
                    terminal.set(true)
                    return
                }
                val delta = parseDelta(data) ?: return
                emitSafely(delta)
            }

            override fun onClosed(eventSource: EventSource) {
                terminal.set(true)
            }

            override fun onFailure(
                eventSource: EventSource,
                t: Throwable?,
                response: okhttp3.Response?,
            ) {
                if (t != null) failure.set(t)
                else if (response != null) failure.set(IOException("HTTP ${response.code}"))
                terminal.set(true)
            }

            private fun emitSafely(delta: StreamDelta) {
                // Bridged below through the Flow collector context.
                pending.add(delta)
            }
        }

        val pending = ArrayDeque<StreamDelta>()
        val factory = EventSources.createFactory(httpClient)
        val eventSource = withContext(Dispatchers.IO) {
            factory.newEventSource(request, listener)
        }
        sourceRef.set(eventSource)

        try {
            while (!terminal.get() || pending.isNotEmpty()) {
                while (pending.isNotEmpty()) emit(pending.removeFirst())
                failure.get()?.let { throw it }
                kotlinx.coroutines.delay(10L)
            }
            failure.get()?.let { throw it }
        } catch (cancel: CancellationException) {
            throw cancel
        } finally {
            sourceRef.getAndSet(null)?.cancel()
        }
    }

    private fun buildJsonPayload(sessionId: String, prompt: String): String {
        val system = org.json.JSONObject().apply {
            put("role", PolishSystemPrompt.ROLE)
            put("content", PolishSystemPrompt.CONTENT)
        }
        val user = org.json.JSONObject().apply {
            put("role", "user")
            put("content", prompt)
        }
        val messages = org.json.JSONArray()
            .put(system)
            .put(user)
        return org.json.JSONObject()
            .put("messages", messages)
            .put("session_id", sessionId)
            .put("stream", true)
            .toString()
    }

    private fun parseDelta(data: String): StreamDelta? = runCatching {
        val obj = org.json.JSONObject(data)
        val id = obj.optString("message_id").ifBlank { UUID.randomUUID().toString() }
        val text = when {
            obj.has("choices") -> obj.optJSONArray("choices")
                ?.optJSONObject(0)
                ?.optJSONObject("delta")
                ?.optString("content")
                .orEmpty()
            obj.has("text") -> obj.optString("text")
            obj.has("delta") -> obj.optString("delta")
            else -> ""
        }
        if (text.isBlank()) null else StreamDelta(id, text, data)
    }.getOrNull()

    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

        fun recommendedClient(base: OkHttpClient): OkHttpClient = base.newBuilder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }
}
