# SONEC TODO List

## Completed ✅
- [x] Inline code completion works (neural model via Ollama)
- [x] Autonomous refactoring works (scan & fix flow)
- [x] Tab-to-Jump indicator (floating badge at cursor)
- [x] Tab-to-Fix: jump to error + ghost text preview + TAB to accept
- [x] Tab-to-Remove: delete predictions shown as empty replacements
- [x] Tab-to-Insert: new code suggestions via ghost text
- [x] Multi-file jump navigation (cross-file badge "TAB to filename")
- [x] Jump loop prevention (no re-jump when already at target)
- [x] Sticky jump targets (survive background trajectory updates)
- [x] Prediction cleanup on acceptance (remove used predictions)
- [x] Diagnostics-aware predictions (errors/warnings fed to AI)
- [x] Multiple completions bug fixed (debounced trajectory updates)
- [x] Completion/jump collision fixed (hide suggestions before jump)
- [x] Fuzzy file resolution in ActionEngine (handles partial paths)
- [x] Test suite created (activation, commands, jump-indicator, prediction-engine, action-engine, prompt-builder)
- [x] Jump indicator UI aligned with code suggestions (badge hides when ghost text is active)

## Known Limitations
- [ ] Qwen 1.5B may not always produce valid JSON for predictions (fallback logic handles this)
- [ ] Delete action ghost text is subtle (empty replacement) — could add a status bar message
- [ ] Prefetch only works for the immediate next position after acceptance

## Future Enhancements
- [ ] Multi-line replacement support (fix spans of 2+ lines in one TAB)
- [ ] Prediction history navigation (Cmd+[ to go back to previous prediction)
- [ ] Visual diff preview before acceptance (show red/green inline)
- [ ] Batch fix mode (apply all high-confidence fixes in one command)
- [ ] Tree-sitter integration for better symbol-aware predictions
- [ ] Streaming completions for faster perceived latency
- [ ] Telemetry dashboard for acceptance rate tracking
