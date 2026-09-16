
#!/bin/bash

# write npm run output both to console and to build.log
npm test 2>&1 | tee build.log
build_status=${PIPESTATUS[0]}

# if exit status is not 0, exit with the status code from the build+test run
if [ $build_status -ne 0 ]; then
  echo "Build failed. Exiting with status code $build_status"
  exit $build_status
fi