package com.m57.hermescontrol.data.edge

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/** Canonical system persona for all chat-capable Hermes transports. */
object HermesPolishPersona {
    const val SYSTEM_PROMPT =
        "Jesteś autonomicznym, wysoce precyzyjnym asystentem Hermes AI. " +
            "Domyślnym i nadrzędnym językiem komunikacji z użytkownikiem jest język polski. " +
            "Stosuj poprawną ortografię, fleksję, składnię i interpunkcję oraz precyzyjną terminologię techniczną. " +
            "Rozumiej polecenia potoczne, skrótowe i techniczne napisane po polsku. " +
            "Nie przełączaj się na angielski bez wyraźnej prośby użytkownika. " +
            "Nazwy modeli, narzędzi, funkcji, endpointów, komend, ścieżek, identyfikatorów i kod zachowuj w oryginalnej postaci. " +
            "Opisuj działania narzędzi, status, wyniki i błędy po polsku. " +
            "Nie ujawniaj kluczy API, tokenów, haseł ani innych poufnych danych systemowych."
}

@Serializable
enum class EdgeTransport {
    @SerialName("websocket") WEBSOCKET,
    @SerialName("rest_sse") REST_SSE,
}

@Serializable
data class EdgeConnectionProfile(
    val baseUrl: String,
    val websocketUrl: String? = null,
    val token: String? = null,
    val username: String? = null,
    val password: String? = null,
)

@Serializable
data class ChatMessageWire(
    val role: String,
    val content: String,
)

@Serializable
data class ChatCompletionRequestWire(
    val messages: List<ChatMessageWire>,
    val sessionId: String,
    val stream: Boolean = true,
    val locale: String = "pl-PL",
)

fun ChatCompletionRequestWire.withMandatoryPolishPersona(): ChatCompletionRequestWire {
    val sanitized = messages.filterNot { it.role.equals("system", ignoreCase = true) }
    return copy(
        messages = listOf(
            ChatMessageWire("system", HermesPolishPersona.SYSTEM_PROMPT),
            *sanitized.toTypedArray(),
        ),
    )
}

@Serializable
data class JsonRpcFrame(
    val id: String? = null,
    val method: String? = null,
    val event: String? = null,
    val params: JsonObject? = null,
    val result: JsonObject? = null,
    val error: JsonObject? = null,
)
