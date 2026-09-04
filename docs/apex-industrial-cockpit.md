# Hermes Mobile — Apex Industrial Cockpit

## Założenie

Warstwa Apex integruje się z istniejącą natywną aplikacją Hermes Mobile zamiast zastępować jej architekturę. Android pozostaje klientem natywnym, a funkcje Apex są implementowane jako odporne moduły transportu, języka, offline-first i operacji.

## Zasady integracji

1. WebSocket TUI Gateway jest transportem podstawowym.
2. REST/SSE jest transportem awaryjnym, gdy kanał WebSocket jest niedostępny.
3. Każdy turn rozmowy korzysta z kanonicznego polskiego kontekstu systemowego.
4. Historia i mutacje użytkownika są utrwalane lokalnie przed wysłaniem.
5. Operacje wymagające akceptacji użytkownika mają jawny stan Human-in-the-Loop.
6. Nie powstaje drugi klient ani drugi cykl życia połączenia.
7. Istniejące mechanizmy autoryzacji, Room, WebSocket, powiadomień i lifecycle pozostają źródłem prawdy.

## Warstwa językowa

Kanoniczny prompt znajduje się w `data/ai/PolishSystemPrompt.kt` i jest używany przez transporty mobilne. TTS oraz STT pozostają natywne dla Androida.

## Transport awaryjny

`data/network/ApexTransport.kt` zapewnia natywny POST do `/v1/chat/completions` z SSE. Payload zawsze rozpoczyna `messages` od obiektu systemowego PL, a następnie wysyła wiadomość użytkownika.

## Kierunek dalszej integracji

- połączyć fallback z istniejącym `HermesWsClient` przez jednolity interfejs transportowy;
- dodać trwałą outbox queue w istniejącej bazie Room;
- ujednolicić zdarzenia HitL, Cron, PTY/ANSI i telemetrykę transportu;
- dodać testy kontraktowe WebSocket/REST oraz testy odtwarzania kolejki po powrocie sieci;
- zachować obecne mechanizmy foreground/background i watchdog połączenia.
