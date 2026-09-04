package com.m57.hermescontrol.data.edge

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.UUID

sealed interface RestSseEvent {
    data class Delta(val text: String) : RestSseEvent
    data class Done(val responseId: String? = null) : RestSseEvent
    data class Error(val message: String) : RestSseEvent
}

/**
 * Native fallback for environments where the dashboard WebSocket path is
 * unreachable but the chat REST endpoint is available.
 */
class RestSseFallback(
    private val client: OkHttpClient,
) {
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    fun stream(
        baseUrl: String,
        token: String?,
        sessionId: String,
        messages: List<ChatMessageWire>,
    ): Flow<RestSseEvent> = flow {
        val requestBody = ChatCompletionRequestWire(
            messages = messages.map { ChatMessageWire(it.role, it.content) },
            sessionId = sessionId,
            stream = true,
        ).withMandatoryPolishPersona()

        val json = kotlinx.serialization.json.Json.encodeToString(
            ChatCompletionRequestWire.serializer(),
            requestBody,
        )

        val url = baseUrl.trimEnd('/') + "/v1/chat/completions"
        val requestBuilder = Request.Builder()
            .url(url)
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .post(json.toRequestBody(jsonMediaType))

        if (!token.isNullOrBlank()) {
            requestBuilder.header("X-Hermes-Session-Token", token)
            requestBuilder.header("Authorization", "Bearer $token")
        }

        try {
            client.newCall(requestBuilder.build()).execute().use { response ->
                if (!response.isSuccessful) {
                    emit(RestSseEvent.Error("HTTP ${response.code}: ${response.message}"))
                    return@flow
                }

                val body = response.body ?: run {
                    emit(RestSseEvent.Error("Pusta odpowiedź bramy Hermes."))
                    return@flow
                }

                val source = body.source()
                val responseId = UUID.randomUUID().toString()
                while (!source.exhausted()) {
                    val line = source.readUtf8Line() ?: break
                    val trimmed = line.trim()
                    if (trimmed.isEmpty() || trimmed.startsWith(":")) continue
                    if (!trimmed.startsWith("data:")) continue

                    val payload = trimmed.removePrefix("data:").trim()
                    if (payload == "[DONE]") {
                        emit(RestSseEvent.Done(responseId))
                        break
                    }

                    val delta = extractDelta(payload)
                    if (!delta.isNullOrEmpty()) {
                        emit(RestSseEvent.Delta(delta))
                    }
                }
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: IOException) {
            emit(RestSseEvent.Error(error.localizedMessage ?: "Błąd połączenia SSE."))
        }
    }.flowOn(Dispatchers.IO)

    private fun extractDelta(payload: String): String? = runCatching {
        val root = org.json.JSONObject(payload)
        root.optJSONArray("choices")
            ?.optJSONObject(0)
            ?.optJSONObject("delta")
            ?.optString("content", null)
            ?: root.optString("text", null)
            ?: root.optString("delta", null)
    }.getOrNull()
}
