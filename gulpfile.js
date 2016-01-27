var gulp = require('gulp'),
  ts = require('gulp-typescript'),
  tslint = require('gulp-tslint');

var allTypescript = './bot-ts/**/*.ts'; 
var allTypings = './typings/**/*.ts';
var jsOutput = './bot-js/';

gulp.task('ts-lint', function () {
  return gulp.src(allTypescript).pipe(tslint()).pipe(tslint.report('prose'));
});

gulp.task('ts-compile', function() {
  return gulp.src([allTypescript, allTypings])
  .pipe(ts({module: 'commonjs'})).js.pipe(gulp.dest(jsOutput));
});

gulp.task('copy-config', function() {
    return gulp.src('./bot-ts/config.json').pipe(gulp.dest(jsOutput));
});

gulp.task('watch', function() {
    gulp.watch([allTypescript], ['ts-lint', 'ts-compile']);
});

gulp.task('default', ['ts-lint', 'ts-compile', 'copy-config', 'watch']);
