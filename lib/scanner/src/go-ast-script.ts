/**
 * Embedded Go helper. Keeping the source in the bundle avoids relying on a
 * sibling file after api-server's esbuild step. The helper uses only the Go
 * standard library and receives bounded scan content over stdin.
 */
export const GO_AST_SCRIPT = String.raw`package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strconv"
)

type inputFile struct {
	Path    string
	Content string
}

func lineFor(fset *token.FileSet, pos token.Pos) int {
	return fset.Position(pos).Line
}

func receiverName(expr ast.Expr) string {
	switch value := expr.(type) {
	case *ast.Ident:
		return value.Name
	case *ast.StarExpr:
		return receiverName(value.X)
	case *ast.IndexExpr:
		return receiverName(value.X)
	case *ast.IndexListExpr:
		return receiverName(value.X)
	default:
		return ""
	}
}

func typeKind(expr ast.Expr) string {
	switch expr.(type) {
	case *ast.StructType:
		return "struct"
	case *ast.InterfaceType:
		return "interface"
	case *ast.Ident:
		return "alias"
	default:
		return "defined"
	}
}

func entity(kind string, name string, line int, extra map[string]interface{}) map[string]interface{} {
	value := map[string]interface{}{
		"type": kind,
		"name": name,
		"line": line,
	}
	for key, item := range extra {
		value[key] = item
	}
	return value
}

func parseFile(file inputFile) map[string]interface{} {
	fset := token.NewFileSet()
	tree, err := parser.ParseFile(fset, file.Path, file.Content, parser.ParseComments)
	if err != nil {
		return map[string]interface{}{
			"path":    file.Path,
			"entities": []interface{}{},
			"imports":  []interface{}{},
			"error":   err.Error(),
		}
	}

	entities := make([]interface{}, 0)
	imports := make([]interface{}, 0)
	entities = append(entities, entity(
		"module",
		"package "+tree.Name.Name,
		lineFor(fset, tree.Name.Pos()),
		map[string]interface{}{"package": tree.Name.Name, "kind": "go-package"},
	))

	for _, declaration := range tree.Decls {
		switch node := declaration.(type) {
		case *ast.GenDecl:
			if node.Tok != token.TYPE {
				continue
			}
			for _, specification := range node.Specs {
				typeSpec, ok := specification.(*ast.TypeSpec)
				if !ok {
					continue
				}
				entities = append(entities, entity(
					"class",
					typeSpec.Name.Name,
					lineFor(fset, typeSpec.Name.Pos()),
					map[string]interface{}{
						"kind":     "go-type",
						"typeKind": typeKind(typeSpec.Type),
						"package":  tree.Name.Name,
					},
				))
			}
		case *ast.FuncDecl:
			name := node.Name.Name
			if node.Recv != nil && len(node.Recv.List) > 0 {
				receiver := receiverName(node.Recv.List[0].Type)
				if receiver != "" {
					name = receiver + "." + name
				}
			}
			entities = append(entities, entity(
				"function",
				name,
				lineFor(fset, node.Name.Pos()),
				map[string]interface{}{"package": tree.Name.Name},
			))
		}
	}

	for _, specification := range tree.Imports {
		importPath, err := strconv.Unquote(specification.Path.Value)
		if err != nil {
			continue
		}
		imports = append(imports, map[string]interface{}{
			"path":      importPath,
			"line":      lineFor(fset, specification.Path.Pos()),
			"specifier": specification.Path.Value,
		})
	}

	return map[string]interface{}{
		"path":     file.Path,
		"entities": entities,
		"imports":  imports,
	}
}

func main() {
	reader := bufio.NewReader(os.Stdin)
	var files []inputFile
	if err := json.NewDecoder(reader).Decode(&files); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	results := make([]map[string]interface{}, 0, len(files))
	for _, file := range files {
		results = append(results, parseFile(file))
	}
	if err := json.NewEncoder(os.Stdout).Encode(results); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
`;