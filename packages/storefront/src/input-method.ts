/** Accept native events; React handlers should pass event.nativeEvent. */
export function isInputMethodKey(event: { isComposing?: boolean; keyCode?: number }): boolean {
    // Some browsers end composition before dispatching the candidate-confirming keydown.
    return event.isComposing === true || event.keyCode === 229;
}
