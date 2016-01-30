var gulp = require('gulp'),
  ts = require('gulp-typescript'),
  tslint = require('gulp-tslint'),
  replace = require('gulp-replace'),
  rename = require('gulp-rename');

var allTypescript = './bot-ts/**/*.ts'; 
var allTypings = './typings/**/*.ts';
var jsOutput = './bot-js/';
var deployOutput = '../onebotaway-deploy/';

gulp.task('ts-lint', function () {
  return gulp.src(allTypescript).pipe(tslint()).pipe(tslint.report('prose'));
});

gulp.task('ts-compile', function() {
  return gulp.src([allTypescript, allTypings])
  .pipe(ts({module: 'commonjs'})).js.pipe(gulp.dest(jsOutput));
});

gulp.task('watch', function() {
    gulp.watch([allTypescript], ['ts-lint', 'ts-compile']);
});

gulp.task('deploy', ['deploy-compile', 'deploy-move']);

gulp.task('deploy-compile', function() {
    return gulp.src([allTypescript, allTypings])
    .pipe(ts({module: 'commonjs'})).js
    .pipe(rename('app.js'))
    .pipe(replace('nconf.get(\'ONE_BUS_AWAY\')', 'process.env.oneBusAway'))
    .pipe(replace('nconf.get(\'SLACK_TOKEN\')', 'process.env.slackToken'))
    .pipe(gulp.dest(deployOutput));
});

gulp.task('deploy-move', function() {
    return gulp.src('./package.json').pipe(gulp.dest(deployOutput));
});

gulp.task('default', ['ts-lint', 'ts-compile', 'watch']);
