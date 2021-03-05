var util = require('util'),
	falafel = require('falafel'),
	Syntax = require('./syntax.js');
const { SourceMapConsumer } = require('source-map');
const path = require('path');
const fs = require('fs');


const FN_WRAPPER_HEAD = 'return __njstrace__fnWrapper({ fnId: %s, name: %s, file: %s, startLine: %s, startColumn: %s }, (%s {';
const FN_WRAPPER_FOOTER = '}).bind(this));';


// var TRACE_ENTRY = 'var __njsEntryData__ = __njsTraceEntry__({file: %s, name: %s, line: %s, args: %s});';
// var TRACE_EXIT = '__njsTraceExit__({entryData: __njsEntryData__, exception: %s, line: %s, returnValue: %s});';
// var ON_CATCH = 'if (__njsOnCatchClause__) {\n__njsOnCatchClause__({entryData: __njsEntryData__});\n}';

/**
 * Creates a new instance of Instrumentation "class"
 * @class Provides instrumentation functionality
 * @param {NJSTrace} njsTrace - A reference to an NJSTrace object
 * @constructor
 */
function Injector(njsTrace) {
	this.njs = njsTrace;
}

/**
 * Returns whether the given node is a function node
 * @param {Object} node - The node to check
 * @returns {boolean}
 */
Injector.prototype.isFunctionNode = function(node) {
	return (node.type === Syntax.FunctionDeclaration || node.type === Syntax.FunctionExpression || node.type === Syntax.ArrowFunctionExpression) && node.range;
};

/**
 * Gets the function name (if this node is a function node).
 * @param {object} node - The falafel AST node
 * @returns {string} The function name
 */
Injector.prototype.getFunctionName = function(node) {
	// Make sure this is a function node.
	if (!this.isFunctionNode(node)) {
		return;
	}

	// Not all functions have ids (i.e Anonymous functions), in case we do have id we can get it and stop.
	if (node.id) {
		return node.id.name;
	}

	// FunctionDeclaration (function foo(){...}) should ALWAYS have id,
	// so in case this is FunctionDeclaration and it had no id it's an error.
	if (node.type === Syntax.FunctionDeclaration) {
		this.njs.emit(this.njs.prototype.events.Error, new Error('A FunctionDeclaration node has no id data, node:' + JSON.stringify(node)));
		return '';
	}

	// So this is an anonymous FunctionExpression, we try to get a name using the parent data,
	// for example in case of: var foo = function(){}, the name would be foo.
	var parent = node.parent;
	switch (parent.type) {
		// var f; f = function () {...}
		case Syntax.AssignmentExpression:
			// Extract the variable name
			if (parent.left.range) {
				return parent.left.source().replace(/"/g, '\\"');
			}
			break;

		// var f = function(){...}
		case Syntax.VariableDeclarator:
			return parent.id.name;

		// IIFE (function(scope) {})(module);
		case Syntax.CallExpression:
			return parent.callee.id ? parent.callee.id.name : '[Anonymous]';

		// Don't give up, can still find
		default:
			// Happens when a function is passed as an argument foo(function() {...})
			if (typeof parent.length === 'number') {
				return parent.id ? parent.id.name : '[Anonymous]';
				// Not sure when this happens...
			} else if (parent.key && parent.key.type === 'Identifier' &&
				parent.value === node && parent.key.name) {
				return parent.key.name;
			}
	}

	return '[Anonymous]';
};

/**
 * Checks whether this node belongs to Node's wrapper function (the top level function that wraps every Node's module)
 * @param {object} node - The falafel AST node
 * @returns {boolean}
 */
Injector.prototype.isOnWrapperFunction = function(node) {
	var parent = node.parent;
	while (parent) {
		if (this.isFunctionNode(parent)) {
			return parent.loc.start.line === 1;
		}

		parent = parent.parent;
	}

	return true;
};

function findSourceMappingURL(content) {
	const re = /(?:\/\/[@#][\s]*sourceMappingURL=([^\s'"]+)[\s]*$)|(?:\/\*[@#][\s]*sourceMappingURL=([^\s*'"]+)[\s]*(?:\*\/)[\s]*$)/mg;
	// Keep executing the search to find the *last* sourceMappingURL to avoid
	// picking up sourceMappingURLs from comments, strings, etc.
	let lastMatch, match;
	while (match = re.exec(content)) {
		lastMatch = match;
	}
	if (!lastMatch) {
		return null;
	}
	return lastMatch[1];
}


/**
 * Inject njsTrace tracing functions into the given code text
 * @param {string} filename - The file being instrumented
 * @param {string} code - The JS code to trace
 * @param {Boolean} wrapFunctions - Whether to wrap functions in try/catch
 * @param {boolean} includeArguments - Whether a traced function arguments and return values should be passed to the tracer
 * @param {boolean} wrappedFile - Whether this entire file is wrapped in a function (i.e like node is wrapping the modules in a function)
 * @returns {string} The modified JS code text
 */
Injector.prototype.injectTracing = function(filename, code, wrapFunctions, includeArguments, wrappedFile, relPath) {
	const sourceMappingURL = findSourceMappingURL(code);
	let sourceMapConsumer = null;
	if (sourceMappingURL) {
		const resolvedSourceMappingURL = path.resolve(path.dirname(filename), sourceMappingURL);
		const sourceMapContent = fs.readFileSync(resolvedSourceMappingURL, { encoding: 'utf8', flag: 'r'});
		sourceMapConsumer = new SourceMapConsumer(sourceMapContent);
	}

	// sourceMapConsumer.eachMapping(r => {
	// 	console.log(r);
	// });

	var self = this;
	var output = falafel(code, {ranges: true, locations: true, ecmaVersion: 10}, function processASTNode(node) {
		// In wrapped files the first line is the wrapper function so we need to offset location to get the real lines in user-world
		var startLine = wrappedFile ? node.loc.start.line - 1 : node.loc.start.line;
		// var retLine = wrappedFile ? node.loc.end.line - 1 : node.loc.end.line;
		var startColumn = node.loc.start.column;

		// If we have name this is a function
		var name = self.getFunctionName(node);
		if (name && name !== 'constructor' && !node.generator && node.body.type === Syntax.BlockStatement) { // Not supporting arrow functions with no body
			self.njs.log('  Instrumenting ', name, 'line:', startLine, 'colum:', node.loc.start.column);

			if (sourceMapConsumer) {
				try {
					const resolvedDescriptor = sourceMapConsumer.originalPositionFor({ line: startLine, column: startColumn });
					if (resolvedDescriptor.line === null || resolvedDescriptor.column === null) {
						return;
					}
					startLine = resolvedDescriptor.line;
					startColumn = resolvedDescriptor.column;
				} catch(e) {
					return;
				}
			}
			// console.log(name, resolvedDescriptor); // REMOVE: remove console log

			// Separate the function declaration ("function foo") from function body ("{...}");
			var funcDec = node.source().slice(0, node.body.range[0] - node.range[0]);
			var origFuncBody = node.body.source();
			origFuncBody = origFuncBody.slice(1, origFuncBody.length - 1); // Remove the open and close braces "{}"

			// If this file is wrapped in a function and this is the first line, it means that this is the call
			// to the file wrapper function, in this case we don't want to instrument it (as this function is hidden from the user and also creates a mess with async/await)
			// In reality it means that this is the function that Node is wrapping all the modules with and call it when
			// the module is being required.
			if (wrappedFile && node.loc.start.line === 1) {return;}

			const fnId = `${name}@${relPath}::${startLine}:${startColumn}`;
			const fnDeclaration = node.async ? 'async function ()' : node.generator ? 'function* ()' : 'function ()';
			const head = util.format(FN_WRAPPER_HEAD, JSON.stringify(fnId), JSON.stringify(name), JSON.stringify(relPath), startLine, startColumn, fnDeclaration);
			const footer = FN_WRAPPER_FOOTER;

			const newFuncBody = '\n' + head + '\n' + origFuncBody + '\n' + footer + '\n';

			node.update(funcDec + '{' + newFuncBody + '}');
		}
	});

	const result = output.toString();

	return result;
};

module.exports = Injector;
