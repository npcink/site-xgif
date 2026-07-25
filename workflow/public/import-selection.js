export function summarizeImportSelection(states = []) {
  const total = states.length;
  const selectable = states.filter((state) => !state.disabled).length;
  const selected = states.filter((state) => !state.disabled && state.checked).length;

  return {
    total,
    selectable,
    selected,
    unselected: total - selected,
    allSelected: selectable > 0 && selected === selectable,
  };
}

export function importItemMatchesFilter(state, filter = "all") {
  if (filter === "needs-review") return state.status === "review" || state.status === "similar";
  return true;
}
