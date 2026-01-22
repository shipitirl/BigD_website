function inferServiceType(text) {
  const t = text.toLowerCase();
  console.log(`[DEBUG] inferServiceType input: "${text}" -> lower: "${t}"`);
  if (t.includes("stump")) return "stump_grinding";
  if (t.includes("trim") || t.includes("prune")) return "trimming";
  if (t.includes("storm") || t.includes("down") || t.includes("fallen") || t.includes("emergency")) return "storm_cleanup";
  if (t.includes("remove") || t.includes("cut") || t.includes("take down")) return "tree_removal";
  return "unknown";
}
const input = "Tree removal";
const t = input.toLowerCase();
console.log(`Input: "${input}"`);
console.log(`Lower: "${t}"`);
console.log(`Includes 'remove'?`, t.includes("remove"));
console.log(`Index of 'remove':`, t.indexOf("remove"));
console.log("Char codes of input 'remove':", "remove".split('').map(c => c.charCodeAt(0)));
console.log("Char codes of t 'remove' substring:", t.substring(5, 11).split('').map(c => c.charCodeAt(0)));
