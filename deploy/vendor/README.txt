Place the unpacked runtime dependencies for the Windows installer in this folder:

1. node-runtime\
   - must contain node.exe at deploy\vendor\node-runtime\node.exe

2. mariadb-runtime\
   - must contain MariaDB ZIP package contents
   - must include deploy\vendor\mariadb-runtime\bin\mariadb-install-db.exe

These vendor runtimes are copied into the staged installer payload by:

  npm run deploy:stage

After staging, build the Inno Setup installer with:

  npm run deploy:installer
