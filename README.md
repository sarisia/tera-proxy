### Fork of Meishuu's/Pinkie Pie's tera-proxy with built-in support for automatic updates. Feel free to visit my Discord server at https://discord.gg/maqBmJV

* Set your region in bin/config.json
* Mods go in bin/node_modules/
* Run TeraProxy.bat as Administrator, then start the game

### Developers: Adding auto-update compatibility to your module
* You'll need to create two files in your root update directory (called UpdateRoot from now on): `module.json` and `manifest.json`.
* `module.json` contains the UpdateRoot URL and optional other data. See https://github.com/hackerman-caali/data-logger/blob/new-auto-updates/update/CaaliLogger/module.json for an example.
* `manifest.json` contains a list of all files required for your module (relative to its root directory) and their corresponding SHA256 hashes. Furthermore, you must specify a list of all packet definitions and versions required by your module here. See https://github.com/hackerman-caali/data-logger/blob/new-auto-updates/update/CaaliLogger/manifest.json for an example.
* That's it! All you need to do now is tell your users to delete any legacy version of your module that they have already installed, and place the `module.json` file in a new, empty directory in their `node_modules` folder. `manifest.json` must not be distributed to your users, it only has to reside in your UpdateRoot. The proxy will recognize the module as auto-updating compatible and install all files from your UpdateRoot. It will also download required packet definitions, if necessary.
* Whenever you push an update, remember to update `manifest.json` as well!
