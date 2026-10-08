import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.name === '__tests__' ? [] : e.isDirectory() ? sources(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : [])
}
test('R-N: capacityForDay is the only producer of occupancyPct in production src', () => {
  const violations: string[] = []
  for (const path of sources(join(process.cwd(), 'src'))) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
    const inspect = (node: ts.Node) => {
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'occupancyPct') {
        const value = node.initializer
        // Schema declaration, null withdrawal, and forwarding the fact are not math.
        const forwarding = ts.isPropertyAccessExpression(value) && value.name.text === 'occupancyPct'
        const schema = relative(process.cwd(), path) === 'src/lib/app-api/appointments-screen-dto.ts'
        if (value.kind !== ts.SyntaxKind.NullKeyword && !forwarding && !schema) checkOwner(node)
      }
      if ((ts.isVariableDeclaration(node) || ts.isShorthandPropertyAssignment(node)) && node.name.getText(source) === 'occupancyPct') checkOwner(node)
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && /occupancyPct$/.test(node.left.getText(source))) checkOwner(node)
      ts.forEachChild(node, inspect)
    }
    const checkOwner = (node: ts.Node) => {
      let parent: ts.Node | undefined = node
      while (parent && !ts.isFunctionDeclaration(parent)) parent = parent.parent
      if (relative(process.cwd(), path) !== 'src/lib/capacity/capacity.ts' || !parent || (parent as ts.FunctionDeclaration).name?.text !== 'capacityForDay') violations.push(relative(process.cwd(), path))
    }
    inspect(source)
  }
  expect(violations).toEqual([])
})
