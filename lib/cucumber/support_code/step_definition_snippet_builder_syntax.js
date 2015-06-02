var _ = require('underscore');

function Syntax() {}
function JavaScriptSyntax() {}
function CoffeeScriptSyntax() {}

Syntax.prototype = {
  getStepDefinitionDocString: function () {
    return 'string';
  },

  getStepDefinitionDataTable: function () {
    return 'table';
  },

  getStepDefinitionCallback: function () {
    return 'done';
  },

  getPatternStart: function () {
    return '/^';
  },

  getPatternEnd: function () {
    return '$/';
  },

  getContextStepDefinitionFunctionName: function () {
    return 'Given';
  },

  getEventStepDefinitionFunctionName: function () {
    return 'When';
  },

  getOutcomeStepDefinitionFunctionName: function () {
    return 'Then';
  },

  getNumberMatchingGroup: function () {
    return '(\\d+)';
  },

  getQuotedStringMatchingGroup: function () {
    return '"([^"]*)"';
  },

  getOutlineExampleMatchingGroup: function () {
    return '(.*)';
  },

  getFunctionParameterSeparator: function () {
    return ', ';
  },

  getStepDefinitionEndComment: function (step) {
    return 'Initially required by ' + step.getUri() + ':' + step.getLine();
  }
};

JavaScriptSyntax.prototype = {
  getStepDefinitionStart: function () {
    return 'this.';
  },

  getStepDefinitionInner1: function () {
    return '(';
  },

  getStepDefinitionInner2: function () {
    return ', function (';
  },

  getStepDefinitionEnd: function (step) {
    return ') {\n  // ' + this.getStepDefinitionEndComment(step) + '\n  done.pending();\n});\n';
  },
};
_.extend(JavaScriptSyntax.prototype, Syntax.prototype);

CoffeeScriptSyntax.prototype = {
  getStepDefinitionStart: function () {
    return '@';
  },

  getStepDefinitionInner1: function () {
    return ' ';
  },

  getStepDefinitionInner2: function () {
    return ', (';
  },

  getStepDefinitionEnd: function (step) {
    return ') ->\n  # ' + this.getStepDefinitionEndComment(step) + '\n  done.pending()\n';
  }
};
_.extend(CoffeeScriptSyntax.prototype, Syntax.prototype);

exports.JavaScript   = JavaScriptSyntax;
exports.CoffeeScript = CoffeeScriptSyntax;
