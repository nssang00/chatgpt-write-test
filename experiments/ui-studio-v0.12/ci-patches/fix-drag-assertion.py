from pathlib import Path
p = Path("e2e/studio.spec.js")
source = p.read_text(encoding="utf-8")
old_before = """  const before = await tree(page).locator('[data-v6-tree-id]').count();
  await root(page).getByRole('button', { name: /Insert/ }).first().click();"""
new_before = """  const originalIds = await tree(page).locator('[data-v6-tree-id]')
    .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-v6-tree-id')));
  const before = originalIds.length;
  await root(page).getByRole('button', { name: /Insert/ }).first().click();"""
old_after = """  await expect(canvas(page).locator('.v6-canvas-control').last()).toContainText('Button');"""
new_after = """  const updatedIds = await tree(page).locator('[data-v6-tree-id]')
    .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-v6-tree-id')));
  const addedIds = updatedIds.filter(id => !originalIds.includes(id));
  expect(addedIds).toHaveLength(1);
  await expect(canvas(page).locator('[data-v6-canvas-id="' + addedIds[0] + '"]')).toContainText('Button');"""
prefix = "test('native pointer drag from Insert drops control into the canvas Frame'"
assert source.count(prefix) == 1
head, body = source.split(prefix, 1)
marker = "\ntest('Code edits update Design through the same v6 document'"
assert body.count(marker) == 1
subject, tail = body.split(marker, 1)
assert subject.count(old_before) == 1, "expected source drag setup not found"
assert subject.count(old_after) == 1, "expected last-element assertion not found"
subject = subject.replace(old_before, new_before).replace(old_after, new_after)
p.write_text(head + prefix + subject + marker + tail, encoding="utf-8")
print("PASS: drag/drop assertion tracks inserted stable ID and actual canvas DOM")
