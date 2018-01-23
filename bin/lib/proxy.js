const { region: REGION, updatelog: UPDATE_LOG, updateat: UPDATE_AT } = require("../config.json");
const REGIONS = require("./regions");
const currentRegion = REGIONS[REGION];

if (!currentRegion) {
  console.error("Unsupported region: " + REGION);
  return;
} else {
  console.log(`[sls] Tera-Proxy configured for region ${REGION}!`);

  // TODO: make auto-updater remove this from servers-eu.json
  if (REGION == "EU" && currentRegion.customServers["33"] && currentRegion.customServers["33"].name == "(INT) - Manahan (Proxy)")
    delete currentRegion.customServers["33"];
}

let why;
try { why = require("why-is-node-running"); }
catch (_) {}

const fs = require("fs");
const net = require("net");
const path = require("path");
const dns = require("dns");
const hosts = require("./hosts");
const { customServers, listenHostname, hostname } = currentRegion;

try { hosts.remove(listenHostname, hostname); }
catch (e) {
  switch (e.code) {
   case "EACCES":
    console.error(`ERROR: Hosts file is set to read-only.

* Make sure no anti-virus software is running.
* Locate "${e.path}", right click the file, click 'Properties', uncheck 'Read-only' then click 'OK'.`);
    break;
   case "EPERM":
    console.error(`ERROR: Insufficient permission to modify hosts file.

* Make sure no anti-virus software is running.
* Right click TeraProxy.bat and select 'Run as administrator'.`);
    break;
   default:
    throw e;
  }

  process.exit(1);
}

const moduleBase = path.join(__dirname, "..", "node_modules");
let modules;

function populateModulesList() {
  modules = [];
  for (let i = 0, k = -1, arr = fs.readdirSync(moduleBase), len = arr.length; i < len; ++i) {
    const name = arr[i];
    if (name[0] === "." || name[0] === "_") continue;
    modules[++k] = name;
  }
}

const SlsProxy = require("tera-proxy-sls");

const servers = new Map();
const proxy = new SlsProxy(currentRegion);

function customServerCallback(server) {
  const { address, port } = server.address();
  console.log(`[game] listening on ${address}:${port}`);
}

function listenHandler(err) {
  if (err) {
    const { code } = err;
    if (code === "EADDRINUSE") {
      console.error("ERROR: Another instance of TeraProxy is already running, please close it then try again.");
      process.exit();
    }
    else if (code === "EACCES") {
      let port = currentRegion.port;
      console.error("ERROR: Another process is already using port " + port + ".\nPlease close or uninstall the application first:");
      return require("./netstat")(port);
    }
    throw err;
  }

  hosts.set(listenHostname, hostname);
  console.log("[sls] server list overridden");

  for (let i = servers.entries(), step; !(step = i.next()).done; ) {
    const [id, server] = step.value;
    const currentCustomServer = customServers[id];

    server.listen(currentCustomServer.port, currentCustomServer.ip || "127.0.0.1", customServerCallback.bind(null, server));
  }
}

let lastUpdateResult = {"failed": [], "legacy": [], "updated": []};

function runServ(target, socket) {
  const { Connection, RealClient } = require("tera-proxy-game");

  const connection = new Connection();
  const client = new RealClient(connection, socket);
  const srvConn = connection.connect(client, {
    host: target.ip,
    port: target.port
  });

  for (let name of lastUpdateResult["failed"])
    console.log("WARNING: Module %s could not be updated and will not be loaded!", name);
  for (let name of lastUpdateResult["legacy"]) {
    console.log("WARNING: Module %s does not support auto-updating!", name);
    connection.dispatch.load(name, module);
  }
  for (let name of lastUpdateResult["updated"])
    connection.dispatch.load(name, module);

  let remote = "???";

  socket.on("error", console.warn);

  srvConn.on("connect", () => {
    remote = socket.remoteAddress + ":" + socket.remotePort;
    console.log("[connection] routing %s to %s:%d", remote, srvConn.remoteAddress, srvConn.remotePort);
  })

  srvConn.on("error", console.warn);

  srvConn.on("close", () => {
    console.log("[connection] %s disconnected", remote);
    console.log("[proxy] unloading user modules");
    for (let i = 0, arr = Object.keys(require.cache), len = arr.length; i < len; ++i) {
      const key = arr[i];
      if (key.startsWith(moduleBase)) {
        delete require.cache[key];
      }
    }
  })
}

const autoUpdate = require("./update");

function createServ(target, socket) {
  socket.setNoDelay(true);

  populateModulesList();

  if(UPDATE_AT === undefined || UPDATE_AT === "login") {
    autoUpdate(moduleBase, modules, UPDATE_LOG).then((updateResult) => {
      if(!updateResult["tera-data"])
        console.log("WARNING: There were errors updating tera-data. This might result in further errors.");

      delete require.cache[require.resolve("tera-data-parser")];
      delete require.cache[require.resolve("tera-proxy-game")];

      lastUpdateResult = updateResult;
      runServ(target, socket);
    }).catch((e) => {
      console.log("ERROR: Unable to auto-update: %s", e);
    })
  } else {
    runServ(target, socket);
  }
}

function startProxy() {
  dns.setServers(["8.8.8.8", "8.8.4.4"]);

  proxy.fetch((err, gameServers) => {
    if (err) throw err;

    for (let i = 0, arr = Object.keys(customServers), len = arr.length; i < len; ++i) {
      const id = arr[i];
      const target = gameServers[id];
      if (!target) {
        console.error(`server ${id} not found`);
        continue;
      }

      const server = net.createServer(createServ.bind(null, target));
      servers.set(id, server);
    }
    proxy.listen(listenHostname, listenHandler);
  });
}

if(UPDATE_AT === "startup") {
  populateModulesList();
  autoUpdate(moduleBase, modules, UPDATE_LOG).then((updateResult) => {
    if(!updateResult["tera-data"])
      console.log("WARNING: There were errors updating tera-data. This might result in further errors.");

    delete require.cache[require.resolve("tera-data-parser")];
    delete require.cache[require.resolve("tera-proxy-game")];

    lastUpdateResult = updateResult;
    startProxy();
  }).catch((e) => {
    console.log("ERROR: Unable to auto-update: %s", e);
  })
} else {
  startProxy();
}

const isWindows = process.platform === "win32";

function cleanExit() {
  console.log("terminating...");

  try { hosts.remove(listenHostname, hostname); }
  catch (_) {}

  proxy.close();
  for (let i = servers.values(), step; !(step = i.next()).done; )
    step.value.close();

  if (isWindows) {
    process.stdin.pause();
  }

  setTimeout(() => {
    why && why();
    process.exit();
  }, 5000).unref();
}

if (isWindows) {
  require("readline").createInterface({
    input: process.stdin,
    output: process.stdout
  }).on("SIGINT", () => process.emit("SIGINT"));
}

process.on("SIGHUP", cleanExit);
process.on("SIGINT", cleanExit);
process.on("SIGTERM", cleanExit);
