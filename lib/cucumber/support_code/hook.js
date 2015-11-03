function Hook(code, options) {
  var Cucumber = require('../../cucumber');
  var self = Cucumber.SupportCode.StepDefinition(Hook.EMPTY_PATTERN, {}, code, global.CUKE_LAST_CODE_PATH, global.CUKE_SUPPORT_CODE_TYPE);
  var tags = options.tags || [];

  self.matchesStepName = function matchesStepName() {
    return false;
  };

  self.buildInvocationParameters = function buildInvocationParameters(step, scenario, callback, paramCount) {
      if (options.noScenario || paramCount === 1) {
          return [callback];
      } else {
          return [scenario, callback];
      }
  };

  self.appliesToScenario = function appliesToScenario(scenario) {
    var astFilter = self.getAstFilter();
    return astFilter.isElementEnrolled(scenario);
  };

  self.getAstFilter = function getAstFilter() {
    var tagGroups = Cucumber.TagGroupParser.getTagGroupsFromStrings(tags);
    var rules = tagGroups.map(function (tagGroup) {
      var rule = Cucumber.Ast.Filter.AnyOfTagsRule(tagGroup);
      return rule;
    });
    var astFilter = Cucumber.Ast.Filter(rules);
    return astFilter;
  };

  self.validCodeLengths = function validCodeLengths (parameters) {
    var valid = [parameters.length - 1, parameters.length];
    if (!options.noScenario) {
      valid.unshift(parameters.length - 2);
    }
    return valid;
  };

  self.invalidCodeLengthMessage = function invalidCodeLengthMessage() {
    var syncOrPromiseLength = options.noScenario ? '0' : '0 or 1';
    var callbackLength = options.noScenario ? '1' : '2';
    return self.buildInvalidCodeLengthMessage(syncOrPromiseLength, callbackLength);
  };

  self.getType = function getType () {
    return 'hook';
  };

  return self;
}

Hook.EMPTY_PATTERN = '';

module.exports = Hook;
