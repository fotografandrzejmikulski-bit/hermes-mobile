package com.m57.hermescontrol.data.ws

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PolishLanguagePolicyTest {
    @Test
    fun `locale is Polish Poland`() {
        assertEquals("pl-PL", PolishLanguagePolicy.LOCALE_TAG)
    }

    @Test
    fun `system prompt is Polish and contains safety requirements`() {
        val prompt = PolishLanguagePolicy.SYSTEM_PROMPT
        assertTrue(prompt.contains("język polski"))
        assertTrue(prompt.contains("poprawną fleksję"))
        assertTrue(prompt.contains("Nie przełączaj się na język angielski"))
        assertTrue(prompt.contains("Nie ujawniaj kluczy API"))
    }

    @Test
    fun `system message has canonical system role`() {
        val message = PolishLanguagePolicy.systemMessage()
        assertEquals("system", message["role"])
        assertEquals(PolishLanguagePolicy.SYSTEM_PROMPT, message["content"])
    }
}
