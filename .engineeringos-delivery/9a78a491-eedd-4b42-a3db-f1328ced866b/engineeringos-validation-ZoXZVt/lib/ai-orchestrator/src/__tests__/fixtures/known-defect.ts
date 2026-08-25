export function evaluateUserExpression(expression: string): unknown {
  return eval(expression);
}