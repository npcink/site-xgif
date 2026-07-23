export function createLibrarySelection() {
  return {
    mode: "explicit",
    files: new Set(),
    excludedFiles: new Set(),
    filter: null,
    filteredTotal: 0,
  };
}

export function clearLibrarySelectionState(selection) {
  selection.mode = "explicit";
  selection.files.clear();
  selection.excludedFiles.clear();
  selection.filter = null;
  selection.filteredTotal = 0;
}

export function selectAllFiltered(selection, filter, total) {
  selection.mode = "filter";
  selection.files.clear();
  selection.excludedFiles.clear();
  selection.filter = { ...filter };
  selection.filteredTotal = Math.max(0, Number(total) || 0);
}

export function isLibraryFileSelected(selection, file) {
  if (selection.mode === "filter") return !selection.excludedFiles.has(file);
  return selection.files.has(file);
}

export function setLibraryFileSelected(selection, file, selected) {
  if (selection.mode === "filter") {
    if (selected) selection.excludedFiles.delete(file);
    else selection.excludedFiles.add(file);
    return;
  }
  if (selected) selection.files.add(file);
  else selection.files.delete(file);
}

export function setLibraryPageSelected(selection, files, selected) {
  for (const file of files) setLibraryFileSelected(selection, file, selected);
}

export function librarySelectionCount(selection) {
  if (selection.mode === "filter") {
    return Math.max(0, selection.filteredTotal - selection.excludedFiles.size);
  }
  return selection.files.size;
}

export function librarySelectionSummary(selection) {
  const count = librarySelectionCount(selection);
  return {
    count,
    filtered: selection.mode === "filter",
    label: count
      ? selection.mode === "filter"
        ? `已选择符合筛选的 ${count} 条内容`
        : `已选择 ${count} 条内容`
      : "未选择内容",
  };
}

export function libraryBatchPayload(selection, explicitItems) {
  if (selection.mode === "filter") {
    return {
      selection: {
        ...selection.filter,
        exclude: [...selection.excludedFiles],
      },
    };
  }
  return { items: explicitItems };
}
