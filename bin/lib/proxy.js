const REGION = require("../config.json").region;
const REGIONS = require("./regions");
const request = require('request-promise-native');
const crypto = require('crypto');
const currentRegion = REGIONS[REGION];

if (!currentRegion) {
  console.error("Unsupported region: " + REGION);
  return;
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
      return require("./netstat")();
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

const TeraDataAutoUpdateServer = "https://raw.githubusercontent.com/hackerman-caali/tera-data/master/";

async function autoUpdateFile(filepath, url) {
  try {
    console.log("Updating %s", filepath);
    const updatedFile = await request({url: url, encoding: null});
  
    let dir = path.dirname(filepath);
    if (!fs.existsSync(dir))
      fs.mkdirSync(dir);
    fs.writeFileSync(filepath, updatedFile);
  } catch (e) {
    console.log("ERROR: Failed to auto-update file %s:\n%s", filepath, e);
  }
}

async function autoUpdateModule(root, updateData, serverIndex = 0) {
  try {
    const manifest = await request({url: updateData["servers"][serverIndex] + 'manifest.json', json: true});
    let promises = [];
    for(let file of manifest["files"]) {
      let filepath = path.join(root, file[0]);
      if(!fs.existsSync(filepath) || crypto.createHash("sha256").update(fs.readFileSync(filepath)).digest().toString("hex") !== file[1])
        promises.push(autoUpdateFile(filepath, updateData["servers"][serverIndex] + file[0]));
    }
    return {"defs": manifest["defs"], "files": promises};
  } catch(e) {
    if(serverIndex + 1 < updateData["servers"].length)
        return autoUpdateModule(root, updateData, serverIndex + 1);
    else
        return Promise.reject(e);
  }
}

async function autoUpdate() {
  console.log("[update] Auto-update started!");
  let requiredDefs = new Set(["C_CHECK_VERSION.1.def"]);
  let updatePromises = [];
  
  for (let i = 0, arr = modules, len = arr.length; i < len; ++i) {
    if(!arr[i].endsWith('.js')) {
      let root = path.join(moduleBase, arr[i]);
      try {
        let updateData = fs.readFileSync(path.join(root, 'module.json'), 'utf8');
        try {
          const moduleConfig = await autoUpdateModule(root, JSON.parse(updateData));
          for(let def of moduleConfig["defs"])
              requiredDefs.add(def[0] + "." + def[1].toString() + ".def");
          updatePromises.concat(moduleConfig["files"]);
        } catch(e) {
          console.log("ERROR: Failed to auto-update module %s:\n%s", arr[i], e);
        }
      } catch(_) { /* legacy module without auto-update functionality */ }
    }
  }
  
  for(let def of requiredDefs) {
    let filepath = path.join(__dirname, '..', '..', 'node_modules', 'tera-data', 'protocol', def);
    if(!fs.existsSync(filepath))
      updatePromises.push(autoUpdateFile(filepath, TeraDataAutoUpdateServer + "protocol/" + def));
  }
  
  const mappings = await request({url: TeraDataAutoUpdateServer + 'mappings.json', json: true});
  for(let region in mappings) {
    let version = mappings[region];
    let protocol_name = 'protocol.' + version.toString() + '.map';
    let sysmsg_name = 'sysmsg.' + version.toString() + '.map';
    
    let protocol_filename = path.join(__dirname, '..', '..', 'node_modules', 'tera-data', 'map', protocol_name);
    if(!fs.existsSync(protocol_filename))
      updatePromises.push(autoUpdateFile(protocol_filename, TeraDataAutoUpdateServer + "map/" + protocol_name));
    
    let sysmsg_filename = path.join(__dirname, '..', '..', 'node_modules', 'tera-data', 'map', sysmsg_name);
    if(!fs.existsSync(sysmsg_filename))
      updatePromises.push(autoUpdateFile(sysmsg_filename, TeraDataAutoUpdateServer + "map/" + sysmsg_name));
  }
    
  await Promise.all(updatePromises);
  console.log("[update] Auto-update complete!");
}

function createServ(target, socket) {
  socket.setNoDelay(true);

  populateModulesList();

  autoUpdate().then(() => {
    const { Connection, RealClient } = require("tera-proxy-game");
    
    const connection = new Connection();
    const client = new RealClient(connection, socket);
    const srvConn = connection.connect(client, {
      host: target.ip,
      port: target.port
    });

    for (let i = 0, arr = modules, len = arr.length; i < len; ++i)
      connection.dispatch.load(arr[i], module);

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
  }).catch((e) => {
    console.log("ERROR: Unable to auto-update: %s", e);
  })
}

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
