export function isCheckedTemplateValue(value) {
  if (value === true) return true;
  return ['true', 'yes', '1', 'checked'].includes(String(value ?? '').trim().toLowerCase());
}

export function normalizeExclusiveChoiceValues(values, keys) {
  const selectedKeys = keys.filter((key) => isCheckedTemplateValue(values[key]));
  const conflicted = selectedKeys.length > 1;
  const selectedKey = selectedKeys.length === 1 ? selectedKeys[0] : '';
  let changed = false;

  for (const key of keys) {
    if (!Object.hasOwn(values, key)) continue;
    const normalized = key === selectedKey;
    if (values[key] !== normalized) {
      values[key] = normalized;
      changed = true;
    }
  }

  return { selectedKey, conflicted, changed };
}
