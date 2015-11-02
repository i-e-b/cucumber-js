var fs     = require('fs');
var _ = require('lodash');
var path   = require('path');

var PathExpander = {
  expandPathsWithRegexp: function expandPathsWithRegexp(paths, regexp) {
    var expandedPaths = [];
    paths.forEach(function (path) {
      var expandedPath = PathExpander.expandPathWithRegexp(path, regexp);
      expandedPaths    = expandedPaths.concat(expandedPath);
    });
    expandedPaths = _.uniq(expandedPaths);
    return expandedPaths;
  },

  expandPathWithRegexp: function expandPathWithRegexp(path, regexp) {
    var Cucumber = require('../../cucumber');
    var matches = Cucumber.Cli.Configuration.FEATURE_FILENAME_AND_LINENUM_REGEXP.exec(path);
    var lineNum = matches && matches[2];
    if (lineNum) {
      path = matches[1];
    }
    var realPath = fs.realpathSync(path);
    var stats    = fs.statSync(realPath);
    if (stats.isDirectory()) {
      var paths = PathExpander.expandDirectoryWithRegexp(realPath, regexp);
      return paths;
    }
    else {
      return [realPath];
    }
  },

  expandDirectoryWithRegexp: function expandDirectoryWithRegexp(directory, regexp) {
    var results = [];

    var recur = function recurseDirectory(dir) {
      var xs = fs.readdirSync(dir);
      xs.forEach(function (p) {
        var x = path.join(dir, p);
        var s = fs.statSync(x);

        if (s.isFile() && regexp.test(x)) {
          return results.push(x);
        }
        if (s.isDirectory()) {
          if (p !== 'node_modules' && p !== 'bower_components') return recurseDirectory(x);
        }
      });
    };

    recur(directory);
    return results;
  }
};
module.exports = PathExpander;
