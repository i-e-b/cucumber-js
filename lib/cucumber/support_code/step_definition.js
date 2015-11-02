// vim: noai:ts=2:sw=2
function StepDefinition(pattern, options, code, uri, codeType) {
  var Cucumber = require('../../cucumber');
  var sourceMap = require('source-map');
  var fs = require('fs');

  function time() {
    if (typeof process !== 'undefined' && process.hrtime) {
      return process.hrtime();
    }
    else {
      return new Date().getTime();
    }
  }

  function durationInNanoseconds(start) {
    if (typeof process !== 'undefined' && process.hrtime) {
      var duration = process.hrtime(start);
      return duration[0] * 1e9 + duration[1];
    }
    else {
      return (new Date().getTime() - start) * 1e6;
    }
  }

  var self = {
    getUri: function getUri() {
      return uri;
    },

    getPatternRegexp: function getPatternRegexp() {
      var regexp;
      if (pattern.replace) {
        var regexpString = pattern
        .replace(StepDefinition.UNSAFE_STRING_CHARACTERS_REGEXP, StepDefinition.PREVIOUS_REGEXP_MATCH)
        .replace(StepDefinition.QUOTED_DOLLAR_PARAMETER_REGEXP, StepDefinition.QUOTED_DOLLAR_PARAMETER_SUBSTITUTION)
        .replace(StepDefinition.DOLLAR_PARAMETER_REGEXP, StepDefinition.DOLLAR_PARAMETER_SUBSTITUTION);
        regexpString =
        StepDefinition.STRING_PATTERN_REGEXP_PREFIX +
          regexpString +
          StepDefinition.STRING_PATTERN_REGEXP_SUFFIX;
        regexp = new RegExp(regexpString);
      }
      else
        regexp = pattern;
      return regexp;
    },

    matchesStepName: function matchesStepName(stepName, tagNames) {
      var regexp = self.getPatternRegexp();
      var found = regexp.test(stepName);

      // If we're a primary step def (i.e. loaded from 'support' folder) then ignore tags
      //   and match as normal. Otherwise, if any tags start `@:` or `@./` then do uri matching
      //   before reporting a match.

      if (found && codeType !== 'primary') {
        var sourcesSpecified = false;
        var tagMatchesUri = false;
        var fullPath = (uri||'').replace(/\\/g, '/');
        var endSlash = fullPath.lastIndexOf('/');
        var fileNameNoPathOrExtension = fullPath.slice(endSlash + 1, -3);
        var pathWithNoFilename = fullPath.slice(0, endSlash);

        (tagNames || []).some(function(tag) {
          var byName = tag.indexOf('@:') === 0;
          var byPathEnd = tag.indexOf('@./') === 0;
          if ( ! byName &&  ! byPathEnd) return false;

          sourcesSpecified = true;
          if (byName) {
            var targetName = tag.substr(2);
            if (targetName === fileNameNoPathOrExtension) {
              tagMatchesUri = true;
              return true;
            }
          }
          if (byPathEnd) {
            var targetPath = tag.substr(3);
            var matchPath = pathWithNoFilename.slice(-(targetPath.length));
            if (targetPath === matchPath) {
              tagMatchesUri = true;
              return true;
            }
          }
        });

        if (sourcesSpecified && ! tagMatchesUri) {
          found = false;
        }
      }
      return found;
    },

    invocationCount: 0,

    invoke: function invoke(step, world, scenario, defaultTimeout, callback) {
      self.invocationCount++;
      var start = time();
      var timeoutId;

      var finish = function finish(result) {
        Cucumber.Debug.notice('cleaning up after step\n', 'Cucumber.SupportCode.StepDefinition', 5);
        Cucumber.Util.Exception.unregisterUncaughtExceptionHandler(handleException);
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        callback(result);
        callback = function() {};
      };

      var codeCallback = self.buildCodeCallback(function (error) {
        Cucumber.Debug.notice('stepdef calling back (via callback(...))\n', 'Cucumber.SupportCode.StepDefinition', 5);
        var stepResultData = {
          step: step,
          duration: durationInNanoseconds(start),
          attachments: scenario.getAttachments(),
          status: (error ? Cucumber.Status.FAILED : Cucumber.Status.PASSED)
        };

        if (error) {
          stepResultData.failureException = error || new Error(StepDefinition.UNKNOWN_STEP_FAILURE_MESSAGE);
        }

        var stepResult = Cucumber.Runtime.StepResult(stepResultData);
        finish(stepResult);
      });

      codeCallback.pending = function pending(reason) {
        Cucumber.Debug.notice('stepdef calling back (via callback.pending())\n', 'Cucumber.SupportCode.StepDefinition', 5);
        var pendingStepResult = Cucumber.Runtime.StepResult({
          step: step,
          pendingReason: reason,
          attachments: scenario.getAttachments(),
          status: Cucumber.Status.PENDING
        });
        finish(pendingStepResult);
      };

      var parameters      = self.buildInvocationParameters(step, scenario, codeCallback);
      var handleException = self.buildExceptionHandlerToCodeCallback(codeCallback);

      function onPromiseFulfilled() { codeCallback(); }
      function onPromiseRejected(error) {
        codeCallback(error || new Error(StepDefinition.UNKNOWN_STEP_FAILURE_MESSAGE));
      }
      var timeoutInMilliseconds = options.timeout || defaultTimeout;

      function initializeTimeout() {
        timeoutId = setTimeout(function(){
          codeCallback(new Error('Step timed out after ' + timeoutInMilliseconds + ' milliseconds'));
        }, timeoutInMilliseconds);
      }

      Cucumber.Util.Exception.registerUncaughtExceptionHandler(handleException);

      var validCodeLengths = self.validCodeLengths(parameters);
      if (validCodeLengths.indexOf(code.length) === -1) {
        return codeCallback(new Error(self.invalidCodeLengthMessage(parameters)));
      }

      initializeTimeout();

      var result;
      try {
        result = code.apply(world, parameters);
      } catch (exception) {
        return handleException(exception);
      }

      var callbackInterface = code.length >= parameters.length;
      var promiseInterface = result && typeof result.then === 'function';
      if (callbackInterface && promiseInterface) {
        return codeCallback(new Error(self.getType() + ' accepts a callback and returns a promise'));
      } else if (promiseInterface) {
        return result.then(onPromiseFulfilled, onPromiseRejected);
      } else if (!callbackInterface) {
        return codeCallback();
      } // otherwise the step should be calling the final callback.
    },
    // end of INVOKE

    filePositionFromStackFrame: function(stackFrameMsg) {
      var f = stackFrameMsg.split('(')[1]||stackFrameMsg;
      var n = f.lastIndexOf('.');
      n += Math.max(0, f.substr(n).indexOf(':'));

      var targetFile = f.slice(0, n);            // like '~/prj/file.js' or 'C:\\prj\\file.js'
      var position = f.slice(n+1).split(')')[0]; // like '13:44'

      if (targetFile === '' || position === '') return null; // can't determine source or position

      var p = position.split(':');
      return {
        targetFile:targetFile,
        position:position,
        line: (p[0]) ? (+(p[0])) : (null),
        column: (p[1]) ? (+(p[1])) : (null)
      };
    },

    // try to read a source map for a failure. Does synchronous IO at present... will change
    trySourceMap: function(stackFrameMsg) {
      var src = self.filePositionFromStackFrame(stackFrameMsg);
      if (!src) return stackFrameMsg; // can't determine source or position

      try {
        var map = fs.readFileSync(src.targetFile+'.map');
        map = JSON.parse(map);
        var smc = new sourceMap.SourceMapConsumer(map);
        var realLoc = smc.originalPositionFor({line:src.line, column:src.column});

        if (realLoc.source === null || realLoc.line === null) return stackFrameMsg;

        // replace original file location with mapped location
        return stackFrameMsg.replace(map.file, realLoc.source).replace(':'+src.position, ':'+realLoc.line+':'+realLoc.column);
      } catch (err) {
        return stackFrameMsg; // if no file or conversion fails.
      }
    },

    buildCodeCallback: function buildCodeCallback(callback) {
      return callback;
    },

    buildInvocationParameters: function buildInvocationParameters(step, scenario, callback) {
      var stepName = step.getName();
      var patternRegexp = self.getPatternRegexp();
      var parameters = patternRegexp.exec(stepName);
      parameters.shift();
      if (step.hasAttachment()) {
        var attachmentContents = step.getAttachmentContents();
        parameters.push(attachmentContents);
      }
      parameters.push(callback);
      return parameters;
    },

    buildExceptionHandlerToCodeCallback: function buildExceptionHandlerToCodeCallback(codeCallback) {
      var exceptionHandler = function handleScenarioException(exception) {
        if (exception)
          Cucumber.Debug.warn(exception.stack || exception, 'exception inside feature', 3);
        codeCallback(exception);
      };
      return exceptionHandler;
    },

    validCodeLengths: function validCodeLengths (parameters) {
      return [parameters.length - 1, parameters.length];
    },

    invalidCodeLengthMessage: function invalidCodeLengthMessage(parameters) {
      return self.buildInvalidCodeLengthMessage(parameters.length - 1, parameters.length);
    },

    buildInvalidCodeLengthMessage: function buildInvalidCodeLengthMessage(syncOrPromiseLength, callbackLength) {
      return self.getType() + ' has ' + code.length + ' arguments' +
          ', should have ' + syncOrPromiseLength + ' (if synchronous or returning a promise)' +
          ' or '  + callbackLength + ' (if accepting a callback)';
    },

    getType: function getType () {
      return 'step definition';
    }
  };
  return self;
}

StepDefinition.DOLLAR_PARAMETER_REGEXP              = /\$[a-zA-Z_-]+/g;
StepDefinition.DOLLAR_PARAMETER_SUBSTITUTION        = '(.*)';
StepDefinition.PREVIOUS_REGEXP_MATCH                = '\\$&';
StepDefinition.QUOTED_DOLLAR_PARAMETER_REGEXP       = /"\$[a-zA-Z_-]+"/g;
StepDefinition.QUOTED_DOLLAR_PARAMETER_SUBSTITUTION = '"([^"]*)"';
StepDefinition.STRING_PATTERN_REGEXP_PREFIX         = '^';
StepDefinition.STRING_PATTERN_REGEXP_SUFFIX         = '$';
StepDefinition.UNSAFE_STRING_CHARACTERS_REGEXP      = /[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\|]/g;
StepDefinition.UNKNOWN_STEP_FAILURE_MESSAGE         = 'Step failure';

module.exports = StepDefinition;
