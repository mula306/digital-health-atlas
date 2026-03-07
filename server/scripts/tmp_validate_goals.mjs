import { loadGoalsForValidation, validateGoalAssignment, getRootGoalId } from '../utils/goalValidation.js';

const goals = await loadGoalsForValidation();
console.log('goals', goals.length);
const byId = new Map(goals.map(g=>[Number(g.id), g]));

let pair = null;
for (const g of goals) {
  if (g.parentId && byId.has(Number(g.parentId))) {
    pair = [Number(g.id), Number(g.parentId)];
    break;
  }
}
if (pair) {
  const v = validateGoalAssignment(goals, pair);
  console.log('parent-child pair', pair, 'validation', v);
}

let sameRoot = null;
for (let i=0;i<goals.length;i++) {
  for (let j=i+1;j<goals.length;j++) {
    const a=Number(goals[i].id), b=Number(goals[j].id);
    const ra=getRootGoalId(goals,a);
    const rb=getRootGoalId(goals,b);
    if (ra!==null && ra===rb) {
      sameRoot=[a,b];
      break;
    }
  }
  if (sameRoot) break;
}
if (sameRoot) {
  const v2 = validateGoalAssignment(goals, sameRoot);
  console.log('same-root pair', sameRoot, 'validation', v2);
}
