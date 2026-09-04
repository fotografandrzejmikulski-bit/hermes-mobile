# Hermes Mobile — Apex Polish Edge Cockpit

Ten dokument definiuje docelową warstwę integracyjną Hermes Mobile dla języka `pl-PL`, niskich opóźnień, odporności połączeń oraz mobilnej obsługi głosowej.

## Zasady architektoniczne

1. Natywna aplikacja Android pozostaje głównym klientem. Nie zastępuje jej PWA.
2. `prompt.submit` i `session.redirect` przechodzą przez jeden kanoniczny kontrakt językowy.
3. Język UI, STT i TTS używają `pl-PL`.
4. Warstwa transportowa nie loguje tokenów ani sekretów.
5. Reconnect, replay, backpressure i kolejka RPC pozostają odpowiedzialnością transportu.
6. Elementy renderowane przez Markdown muszą preferować bezpieczne API DOM / Compose zamiast niekontrolowanego HTML.

## Semantyka promptu systemowego

Canonical policy:

- język komunikacji: `pl-PL`
- techniczna polszczyzna i poprawna fleksja
- zachowanie nazw API, nazw modeli, funkcji, komend, ścieżek i kodu
- raportowanie działań narzędzi po polsku
- brak ujawniania sekretów

Uwaga: natywny WebSocket Hermes używa JSON-RPC `prompt.submit`, a nie bezpośrednio OpenAI `chat/completions`. Dlatego polityka jest przenoszona przez wspólną warstwę parametrów RPC. Jeżeli stosowany jest Apex Proxy, proxy może dodatkowo egzekwować właściwy system message przed przekazaniem żądania do backendu.

## Głos

STT powinien używać natywnego Android SpeechRecognizer z lokalizacją `pl-PL`, z obsługą permission/lifecycle i stanów `idle/listening/error`.

TTS powinien preferować głos `pl-PL`, anulować poprzednią wypowiedź przed nową oraz ignorować bloki kodu podczas odczytu.

## Mobile UX

- `adjustResize` pozostaje podstawą natywnego layoutu.
- Composer nie może być zasłaniany przez klawiaturę.
- Mikrofon i akcje krytyczne muszą mieć duże pola dotykowe.
- Haptyka jest warstwą pomocniczą i musi działać tylko wtedy, gdy urządzenie ją wspiera.

## Streaming

WebSocket używa istniejącego mechanizmu:

- kolejkowania wiadomości,
- limitu rozmiaru,
- reconnectu z backoff,
- replay zdarzeń po numerach sekwencyjnych,
- watchdogu liveness,
- pomiaru RTT.

Warstwa Apex nie może dublować tych mechanizmów po stronie Androida.
