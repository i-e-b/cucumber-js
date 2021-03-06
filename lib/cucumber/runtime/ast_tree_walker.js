// vim: noai:ts=2:sw=2
function AstTreeWalker(features, supportCodeLibrary, listeners, options) {
  var Cucumber = require('../../cucumber');

  var world;
  var featuresResult = Cucumber.Runtime.FeaturesResult(options.strict);
  var emptyHook = Cucumber.SupportCode.Hook(function (callback) { callback(); }, {});
  var beforeSteps = Cucumber.Type.Collection();
  var afterSteps = Cucumber.Type.Collection();
  var attachments = [];
  var apiScenario, scenarioResult;

  var self = {
    walk: function walk(callback) {
      self.visitFeatures(features, function () {
        callback(featuresResult.isSuccessful());
      });
    },

    visitFeatures: function visitFeatures(features, callback) {
      var payload = { features: features };
      var event   = AstTreeWalker.Event(AstTreeWalker.FEATURES_EVENT_NAME, payload);
      self.broadcastEventAroundUserFunction(
        event,
        function (callback) { features.acceptVisitor(self, callback); },
        callback
      );
    },

    visitFeature: function visitFeature(feature, callback) {
      if (!featuresResult.isSuccessful() && options.failFast) {
        return callback();
      }
      var payload = { feature: feature };
      var event   = AstTreeWalker.Event(AstTreeWalker.FEATURE_EVENT_NAME, payload);
      self.broadcastEventAroundUserFunction(
        event,
        function (callback) { feature.acceptVisitor(self, callback); },
        callback
      );
    },

    visitBackground: function visitBackground(background, callback) {
 	    var payload = { background: background };
 	    var event = AstTreeWalker.Event(AstTreeWalker.BACKGROUND_EVENT_NAME, payload);
 	    self.broadcastEvent(event, callback);
 	  },

    visitScenario: function visitScenario(scenario, callback) {
      if (!featuresResult.isSuccessful() && options.failFast) {
        return callback();
      }
      supportCodeLibrary.instantiateNewWorld(function (world) {
        // build world and generate entire list of steps (including background and before/after)
        self.setWorld(world);
        self.witnessNewScenario(scenario);
        self.createBeforeAndAfterStepsForAroundHooks(scenario);
        self.createBeforeStepsForBeforeHooks(scenario);
        self.createAfterStepsForAfterHooks(scenario);

        // the steps to run this scenario
        var payload = { scenario: scenario };
        var event = AstTreeWalker.Event(AstTreeWalker.SCENARIO_EVENT_NAME, payload);
        self.broadcastEventAroundUserFunction (
          event,
          function (cb2) {
            self.visitBeforeSteps(function () {
              scenario.acceptVisitor(self, function () {
                self.visitAfterSteps(cb2);
              });
            });
          },
          callback
        );
      });
    },

    createBeforeAndAfterStepsForAroundHooks: function createBeforeAndAfterStepsForAroundHooks(scenario) {
      var aroundHooks = supportCodeLibrary.lookupAroundHooksByScenario(scenario);
      aroundHooks.forEach(function (aroundHook) {
        var beforeStep = Cucumber.Ast.HookStep(AstTreeWalker.AROUND_STEP_KEYWORD);
        beforeStep.setHook(aroundHook);
        beforeSteps.add(beforeStep);
        var afterStep = Cucumber.Ast.HookStep(AstTreeWalker.AROUND_STEP_KEYWORD);
        afterStep.setHook(emptyHook);
        afterSteps.unshift(afterStep);
        aroundHook.setAfterStep(afterStep);
      });
    },

    createBeforeStepsForBeforeHooks: function createBeforeStepsForBeforeHooks(scenario) {
      var beforeHooks = supportCodeLibrary.lookupBeforeHooksByScenario(scenario);
      beforeHooks.forEach(function (beforeHook) {
        var beforeStep = Cucumber.Ast.HookStep(AstTreeWalker.BEFORE_STEP_KEYWORD);
        beforeStep.setHook(beforeHook);
        beforeSteps.add(beforeStep);
      });
    },

    createAfterStepsForAfterHooks: function createAfterStepsForAfterHooks(scenario) {
      var afterHooks = supportCodeLibrary.lookupAfterHooksByScenario(scenario);
      afterHooks.forEach(function (afterHook) {
        var afterStep = Cucumber.Ast.HookStep(AstTreeWalker.AFTER_STEP_KEYWORD);
        afterStep.setHook(afterHook);
        afterSteps.unshift(afterStep);
      });
    },

    visitBeforeSteps: function visitBeforeSteps(callback) {
      beforeSteps.asyncForEach(function (beforeStep, cb2) {
        self.witnessHook();
        beforeStep.acceptVisitor(self, cb2);
      }, callback);
    },

    visitAfterSteps: function visitAfterSteps(callback) {
      afterSteps.asyncForEach(function (afterStep, callback) {
        self.witnessHook();
        afterStep.acceptVisitor(self, callback);
      }, callback);
    },

    visitStep: function visitStep(step, callback, tagNames) {
      step.setTags(tagNames);

      self.witnessNewStep();
      var payload = { step: step };
      var event   = AstTreeWalker.Event(AstTreeWalker.STEP_EVENT_NAME, payload);
      self.broadcastEventAroundUserFunction (
        event,
        function(callback) {
          self.processStep(step, callback, tagNames);
        },
        callback
      );
    },

    visitStepResult: function visitStepResult(stepResult, callback) {
      scenarioResult.witnessStepResult(stepResult);
      featuresResult.witnessStepResult(stepResult);
      var payload = { stepResult: stepResult };
      var event   = AstTreeWalker.Event(AstTreeWalker.STEP_RESULT_EVENT_NAME, payload);
      self.broadcastEvent(event, callback);
    },

    broadcastEventAroundUserFunction: function broadcastEventAroundUserFunction (event, userFunction, callback) {
      var userFunctionWrapper = self.wrapUserFunctionAndAfterEventBroadcast(userFunction, event, callback);
      self.broadcastBeforeEvent(event, userFunctionWrapper);
    },

    wrapUserFunctionAndAfterEventBroadcast: function wrapUserFunctionAndAfterEventBroadcast(userFunction, event, callback) {
      var callAfterEventBroadcast = self.wrapAfterEventBroadcast(event, callback);
      return function callUserFunctionAndBroadcastAfterEvent() {
        userFunction (callAfterEventBroadcast);
      };
    },

    wrapAfterEventBroadcast: function wrapAfterEventBroadcast(event, callback) {
      return function () { self.broadcastAfterEvent(event, callback); };
    },

    broadcastBeforeEvent: function broadcastBeforeEvent(event, callback) {
      var preEvent = event.replicateAsPreEvent();
      self.broadcastEvent(preEvent, callback);
    },

    broadcastAfterEvent: function broadcastAfterEvent(event, callback) {
      var postEvent = event.replicateAsPostEvent();
      self.broadcastEvent(postEvent, callback);
    },

    broadcastEvent: function broadcastEvent(event, callback) {
      function onRuntimeListenersComplete() {
        var listeners = supportCodeLibrary.getListeners();
        broadcastToListeners(listeners, callback);
      }

      function broadcastToListeners(listeners, callback) {
        var iterator = function (listener, callback) {
          listener.hear(event, callback);
        };
        Cucumber.Util.asyncForEach(listeners, iterator, callback);
      }

      broadcastToListeners(listeners, onRuntimeListenersComplete);
    },

    lookupStepDefinitionByName: function lookupStepDefinitionByName(stepName, tagNames) {
      return supportCodeLibrary.lookupStepDefinitionByName(stepName, tagNames);
    },

    setWorld: function setWorld(newWorld) {
      world = newWorld;
    },

    getWorld: function getWorld() {
      return world;
    },

    getDefaultTimeout: function getDefaultTimeout() {
      return supportCodeLibrary.getDefaultTimeout();
    },

    isStepUndefined: function isStepUndefined(step, tagNames) {
      var stepName = step.getName();
      return !supportCodeLibrary.isStepDefinitionNameDefined(stepName, tagNames);
    },

    getScenarioStatus: function getScenarioStatus() {
      return scenarioResult.getStatus();
    },

    getScenarioFailureException: function getScenarioFailureException() {
      return scenarioResult.getFailureException();
    },

    attach: function attach(data, mimeType) {
      attachments.push(Cucumber.Runtime.Attachment({mimeType: mimeType, data: data}));
    },

    getAttachments: function getAttachments() {
      return attachments;
    },

    witnessHook: function witnessHook() {
      attachments = [];
    },

    witnessNewStep: function witnessNewStep() {
      attachments = [];
    },

    witnessNewScenario: function witnessNewScenario(scenario) {
      apiScenario    = Cucumber.Api.Scenario(self, scenario);
      scenarioResult = Cucumber.Runtime.ScenarioResult();
      beforeSteps.clear();
      afterSteps.clear();
    },

    getScenario: function getScenario() {
      return apiScenario;
    },

    isSkippingSteps: function isSkippingSteps() {
      return self.getScenarioStatus() !== Cucumber.Status.PASSED;
    },

    processStep: function processStep(step, callback, tagNames) {
      if (self.isStepUndefined(step, tagNames)) {
        self.skipUndefinedStep(step, callback);
      } else if (options.dryRun || self.isSkippingSteps()) {
        self.skipStep(step, callback);
      } else {
        self.executeStep(step, callback);
      }
    },

    executeStep: function executeStep(step, callback) {
      step.acceptVisitor(self, callback);
    },

    skipStep: function skipStep(step, callback) {
      var skippedStepResult = Cucumber.Runtime.StepResult({step: step, status: Cucumber.Status.SKIPPED});
      self.visitStepResult(skippedStepResult, callback);
    },

    skipUndefinedStep: function skipUndefinedStep(step, callback) {
      var undefinedStepResult = Cucumber.Runtime.StepResult({step: step, status: Cucumber.Status.UNDEFINED});
      
      var alternate = self.findTagToIncludeStep(step.getName()); // is the step defined if we exclude source spec tags?
      if (alternate) {
        undefinedStepResult.AlternateSource = alternate;
      }
      
      self.visitStepResult(undefinedStepResult, callback);
    },

    findTagToIncludeStep : function findTagToIncludeStep(stepName) {
      if (!supportCodeLibrary || !supportCodeLibrary.lookupStepDefinitionByName) return undefined;
      var alternate = supportCodeLibrary.lookupStepDefinitionByName(stepName, []);
      if (!alternate) return undefined;

      var uri = alternate.getUri();
      var idx = Math.max(uri.lastIndexOf('\\'), uri.lastIndexOf('/'));
      uri = uri.slice(idx+1, -3); // just the filename, no path or extension
      return '@:'+uri;
    }
  };
  return self;
}

AstTreeWalker.FEATURES_EVENT_NAME                 = 'Features';
AstTreeWalker.FEATURE_EVENT_NAME                  = 'Feature';
AstTreeWalker.BACKGROUND_EVENT_NAME               = 'Background';
AstTreeWalker.SCENARIO_EVENT_NAME                 = 'Scenario';
AstTreeWalker.STEP_EVENT_NAME                     = 'Step';
AstTreeWalker.STEP_RESULT_EVENT_NAME              = 'StepResult';
AstTreeWalker.ROW_EVENT_NAME                      = 'ExampleRow';
AstTreeWalker.BEFORE_EVENT_NAME_PREFIX            = 'Before';
AstTreeWalker.AFTER_EVENT_NAME_PREFIX             = 'After';
AstTreeWalker.NON_EVENT_LEADING_PARAMETERS_COUNT  = 0;
AstTreeWalker.NON_EVENT_TRAILING_PARAMETERS_COUNT = 2;
AstTreeWalker.AROUND_STEP_KEYWORD                 = 'Around ';
AstTreeWalker.BEFORE_STEP_KEYWORD                 = 'Before ';
AstTreeWalker.AFTER_STEP_KEYWORD                  = 'After ';
AstTreeWalker.Event                               = require('./ast_tree_walker/event');

module.exports = AstTreeWalker;
