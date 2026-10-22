using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("FPV Rig Launcher")]
[assembly: AssemblyDescription("Offline FPV simulator launcher")]
[assembly: AssemblyProduct("FPV Rig")]
[assembly: AssemblyCompany("Mitrakulal")]
[assembly: AssemblyCopyright("Copyright (c) 2026 Mitrakulal")]
[assembly: AssemblyVersion("0.2.0.0")]
[assembly: AssemblyFileVersion("0.2.0.0")]
[assembly: AssemblyInformationalVersion("0.2.0")]

namespace FpvRig
{
    internal static class AppInfo
    {
        public const string Product = "FPV Rig";
        public const string Version = "0.2.0";
        public const string Tagline = "Offline FPV simulator. Your phone is the transmitter.";
    }

    internal static class AppIcon
    {
        public static Icon Load()
        {
            try
            {
                Icon icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (icon != null)
                {
                    return icon;
                }
            }
            catch
            {
            }
            return SystemIcons.Application;
        }
    }

    internal static class Paths
    {
        public static string BaseDir;
        public static string ServerScript;
        public static string PublicDir;
        public static string NodeExe;
        public static string AdbExe;
        public static string DataDir;
        public static string LogsDir;
        public static string BrowserDataDir;
        public static string LauncherLog;
        public static string ServerLog;
        public static string WelcomeMarker;
        public static bool Packaged;

        public static void Discover()
        {
            BaseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');

            string packagedServer = Path.Combine(BaseDir, Path.Combine("server", "server.js"));
            if (File.Exists(packagedServer))
            {
                Packaged = true;
                ServerScript = packagedServer;
                PublicDir = Path.Combine(BaseDir, Path.Combine("server", "public"));
                NodeExe = Path.Combine(BaseDir, Path.Combine("node", "node.exe"));
                AdbExe = Path.Combine(BaseDir, Path.Combine("tools", "adb", "adb.exe"));
            }
            else
            {
                Packaged = false;
                ServerScript = Path.GetFullPath(Path.Combine(BaseDir, Path.Combine("..", "server.js")));
                PublicDir = Path.GetFullPath(Path.Combine(BaseDir, Path.Combine("..", "..", "apps", "server", "public")));
                NodeExe = FindOnPath("node.exe");
                AdbExe = Path.GetFullPath(Path.Combine(BaseDir, Path.Combine("..", "..", "tools", "platform-tools", "adb.exe")));
            }

            if (!File.Exists(NodeExe))
            {
                NodeExe = FindOnPath("node.exe");
            }
            if (!File.Exists(AdbExe))
            {
                string fallback = FindOnPath("adb.exe");
                if (!string.IsNullOrEmpty(fallback))
                {
                    AdbExe = fallback;
                }
            }

            string portable = Path.Combine(BaseDir, "portable.txt");
            if (File.Exists(portable))
            {
                DataDir = Path.Combine(BaseDir, "data");
            }
            else
            {
                DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FPV");
            }

            LogsDir = Path.Combine(DataDir, "logs");
            BrowserDataDir = Path.Combine(DataDir, "browser");
            LauncherLog = Path.Combine(LogsDir, "launcher.log");
            ServerLog = Path.Combine(LogsDir, "server.log");
            WelcomeMarker = Path.Combine(DataDir, "welcome.seen");

            Directory.CreateDirectory(DataDir);
            Directory.CreateDirectory(LogsDir);
            Directory.CreateDirectory(BrowserDataDir);
        }

        public static string FindOnPath(string fileName)
        {
            try
            {
                string path = Environment.GetEnvironmentVariable("PATH");
                if (string.IsNullOrEmpty(path))
                {
                    return null;
                }
                string[] parts = path.Split(Path.PathSeparator);
                for (int i = 0; i < parts.Length; i++)
                {
                    if (string.IsNullOrEmpty(parts[i]))
                    {
                        continue;
                    }
                    string candidate = Path.Combine(parts[i].Trim(), fileName);
                    if (File.Exists(candidate))
                    {
                        return candidate;
                    }
                }
            }
            catch
            {
            }
            return null;
        }
    }

    internal static class Log
    {
        private static readonly object Gate = new object();

        public static void Init()
        {
            try
            {
                if (File.Exists(Paths.ServerLog))
                {
                    string previous = Paths.ServerLog + ".previous";
                    if (File.Exists(previous))
                    {
                        File.Delete(previous);
                    }
                    File.Move(Paths.ServerLog, previous);
                }
                string stamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
                File.AppendAllText(Paths.LauncherLog, "\r\n=== " + AppInfo.Product + " " + AppInfo.Version + "  " + stamp + " ===\r\n");
            }
            catch
            {
            }
        }

        public static void Write(string source, string line)
        {
            if (line == null)
            {
                return;
            }
            try
            {
                lock (Gate)
                {
                    string stamp = DateTime.Now.ToString("HH:mm:ss");
                    File.AppendAllText(Paths.LauncherLog, "[" + stamp + "] [" + source + "] " + line + "\r\n");
                }
            }
            catch
            {
            }
        }

        public static void Server(string line)
        {
            if (line == null)
            {
                return;
            }
            try
            {
                lock (Gate)
                {
                    File.AppendAllText(Paths.ServerLog, line + "\r\n");
                }
            }
            catch
            {
            }
        }

        public static string Tail(string path, int maxLines)
        {
            try
            {
                if (!File.Exists(path))
                {
                    return "";
                }
                string[] lines = File.ReadAllLines(path);
                int start = Math.Max(0, lines.Length - maxLines);
                StringBuilder sb = new StringBuilder();
                for (int i = start; i < lines.Length; i++)
                {
                    sb.AppendLine(lines[i]);
                }
                return sb.ToString();
            }
            catch
            {
                return "";
            }
        }
    }

    internal static class PortPicker
    {
        public static int Find()
        {
            for (int port = 8080; port <= 8180; port++)
            {
                TcpListener listener = null;
                try
                {
                    listener = new TcpListener(IPAddress.Loopback, port);
                    listener.Start();
                    return port;
                }
                catch
                {
                }
                finally
                {
                    if (listener != null)
                    {
                        try
                        {
                            listener.Stop();
                        }
                        catch
                        {
                        }
                    }
                }
            }
            throw new InvalidOperationException("No free local port between 8080 and 8180.");
        }
    }

    internal sealed class HealthSnapshot
    {
        public bool Ok;
        public bool Tx;
        public int TxHz;
        public int Sims;
        public int Txs;
        public string Error = "";
    }

    internal sealed class ServerManager : IDisposable
    {
        private readonly object gate = new object();
        private Process process;
        private System.Threading.Timer healthTimer;
        private int port;
        private bool running;
        private bool starting;
        private string error = "";
        private HealthSnapshot health = new HealthSnapshot();

        public event EventHandler Changed;

        public bool IsRunning
        {
            get { lock (gate) { return running; } }
        }

        public bool IsStarting
        {
            get { lock (gate) { return starting; } }
        }

        public int Port
        {
            get { lock (gate) { return port; } }
        }

        public string Error
        {
            get { lock (gate) { return error; } }
        }

        public HealthSnapshot Health
        {
            get { lock (gate) { return health; } }
        }

        private void RaiseChanged()
        {
            EventHandler handler = Changed;
            if (handler != null)
            {
                try
                {
                    handler(this, EventArgs.Empty);
                }
                catch
                {
                }
            }
        }

        public void Start()
        {
            lock (gate)
            {
                if (running || starting)
                {
                    return;
                }
                starting = true;
                error = "";
            }
            RaiseChanged();

            try
            {
                if (string.IsNullOrEmpty(Paths.NodeExe) || !File.Exists(Paths.NodeExe))
                {
                    throw new InvalidOperationException("Node runtime not found. Expected node\\node.exe in the package.");
                }
                if (!File.Exists(Paths.ServerScript))
                {
                    throw new InvalidOperationException("Server bundle not found: " + Paths.ServerScript);
                }
                if (!Directory.Exists(Paths.PublicDir))
                {
                    throw new InvalidOperationException("Static app folder not found: " + Paths.PublicDir);
                }

                int chosen = PortPicker.Find();
                ProcessStartInfo info = new ProcessStartInfo();
                info.FileName = Paths.NodeExe;
                info.Arguments = "\"" + Paths.ServerScript + "\"";
                info.WorkingDirectory = Paths.BaseDir;
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                info.RedirectStandardOutput = true;
                info.RedirectStandardError = true;
                info.StandardOutputEncoding = Encoding.UTF8;
                info.StandardErrorEncoding = Encoding.UTF8;
                info.EnvironmentVariables["PORT"] = chosen.ToString();
                info.EnvironmentVariables["HOST"] = "127.0.0.1";
                info.EnvironmentVariables["PUBLIC_DIR"] = Paths.PublicDir;

                Process p = new Process();
                p.StartInfo = info;
                p.EnableRaisingEvents = true;
                p.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null)
                    {
                        Log.Server(e.Data);
                    }
                };
                p.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null)
                    {
                        Log.Server("[stderr] " + e.Data);
                    }
                };
                p.Exited += delegate
                {
                    bool notify = false;
                    lock (gate)
                    {
                        if (running || starting)
                        {
                            notify = true;
                        }
                        running = false;
                        starting = false;
                    }
                    Log.Write("launcher", "server process exited");
                    if (notify)
                    {
                        RaiseChanged();
                    }
                };

                lock (gate)
                {
                    process = p;
                    port = chosen;
                }

                Log.Write("launcher", "starting server on 127.0.0.1:" + chosen.ToString());
                p.Start();
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                Log.Write("launcher", "server pid " + p.Id.ToString());

                bool ready = false;
                DateTime deadline = DateTime.UtcNow.AddSeconds(20);
                while (DateTime.UtcNow < deadline)
                {
                    if (p.HasExited)
                    {
                        break;
                    }
                    HealthSnapshot snapshot = FetchHealth(chosen);
                    if (snapshot.Ok)
                    {
                        ready = true;
                        lock (gate)
                        {
                            health = snapshot;
                        }
                        break;
                    }
                    Thread.Sleep(180);
                }

                lock (gate)
                {
                    starting = false;
                    if (ready)
                    {
                        running = true;
                        error = "";
                    }
                    else
                    {
                        running = false;
                        error = "The local server did not become ready. Check the activity log.";
                    }
                }

                if (ready)
                {
                    Log.Write("launcher", "server ready on http://127.0.0.1:" + chosen.ToString());
                    StartHealthTimer();
                }
                else
                {
                    Log.Write("launcher", "server failed to start");
                    StopProcess();
                }
            }
            catch (Exception ex)
            {
                lock (gate)
                {
                    starting = false;
                    running = false;
                    error = ex.Message;
                }
                Log.Write("launcher", "server start failed: " + ex.Message);
            }

            RaiseChanged();
        }

        private void StartHealthTimer()
        {
            lock (gate)
            {
                if (healthTimer != null)
                {
                    healthTimer.Dispose();
                    healthTimer = null;
                }
                healthTimer = new System.Threading.Timer(delegate
                {
                    int p;
                    bool isRunning;
                    lock (gate)
                    {
                        p = port;
                        isRunning = running;
                    }
                    if (!isRunning)
                    {
                        return;
                    }
                    HealthSnapshot snapshot = FetchHealth(p);
                    lock (gate)
                    {
                        health = snapshot;
                    }
                }, null, 700, 1200);
            }
        }

        public void Stop()
        {
            System.Threading.Timer timer;
            lock (gate)
            {
                timer = healthTimer;
                healthTimer = null;
                running = false;
                starting = false;
            }
            if (timer != null)
            {
                timer.Dispose();
            }
            StopProcess();
            Log.Write("launcher", "server stopped");
            RaiseChanged();
        }

        private void StopProcess()
        {
            Process p;
            lock (gate)
            {
                p = process;
                process = null;
            }
            if (p == null)
            {
                return;
            }

            try
            {
                if (!p.HasExited)
                {
                    ProcessStartInfo kill = new ProcessStartInfo();
                    kill.FileName = "taskkill.exe";
                    kill.Arguments = "/PID " + p.Id.ToString() + " /T /F";
                    kill.UseShellExecute = false;
                    kill.CreateNoWindow = true;
                    kill.RedirectStandardOutput = true;
                    kill.RedirectStandardError = true;
                    using (Process k = Process.Start(kill))
                    {
                        if (k != null)
                        {
                            k.WaitForExit(4000);
                        }
                    }
                    p.WaitForExit(4000);
                }
            }
            catch
            {
            }
            finally
            {
                try
                {
                    p.Dispose();
                }
                catch
                {
                }
            }
        }

        private static HealthSnapshot FetchHealth(int port)
        {
            HealthSnapshot snapshot = new HealthSnapshot();
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port.ToString() + "/health");
                request.Proxy = null;
                request.Timeout = 700;
                request.ReadWriteTimeout = 700;
                request.KeepAlive = false;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                {
                    string body = reader.ReadToEnd();
                    snapshot.Ok = true;
                    snapshot.Tx = JsonBool(body, "tx");
                    snapshot.TxHz = JsonInt(body, "txHz");
                    snapshot.Sims = JsonInt(body, "sims");
                    snapshot.Txs = JsonInt(body, "txs");
                }
            }
            catch (Exception ex)
            {
                snapshot.Ok = false;
                snapshot.Error = ex.Message;
            }
            return snapshot;
        }

        private static int JsonInt(string body, string key)
        {
            string marker = "\"" + key + "\"";
            int at = body.IndexOf(marker, StringComparison.Ordinal);
            if (at < 0)
            {
                return 0;
            }
            int colon = body.IndexOf(':', at + marker.Length);
            if (colon < 0)
            {
                return 0;
            }
            int i = colon + 1;
            while (i < body.Length && char.IsWhiteSpace(body[i]))
            {
                i++;
            }
            int start = i;
            while (i < body.Length && (char.IsDigit(body[i]) || body[i] == '-'))
            {
                i++;
            }
            int value;
            if (int.TryParse(body.Substring(start, i - start), out value))
            {
                return value;
            }
            return 0;
        }

        private static bool JsonBool(string body, string key)
        {
            string marker = "\"" + key + "\"";
            int at = body.IndexOf(marker, StringComparison.Ordinal);
            if (at < 0)
            {
                return false;
            }
            int colon = body.IndexOf(':', at + marker.Length);
            if (colon < 0)
            {
                return false;
            }
            int i = colon + 1;
            while (i < body.Length && char.IsWhiteSpace(body[i]))
            {
                i++;
            }
            return i + 4 <= body.Length && body.Substring(i, 4) == "true";
        }

        public void Dispose()
        {
            Stop();
        }
    }

    internal sealed class AdbResult
    {
        public int Code;
        public string Out = "";
        public string Err = "";
        public bool TimedOut;

        public string Message
        {
            get
            {
                string text = (Err + " " + Out).Trim();
                if (text.Length > 240)
                {
                    text = text.Substring(0, 237) + "...";
                }
                return text;
            }
        }
    }

    internal sealed class AdbDevice
    {
        public string Serial = "";
        public string State = "";
        public string Model = "";
    }

    internal static class Adb
    {
        public static AdbResult Run(string args, int timeoutMs)
        {
            AdbResult result = new AdbResult();
            string adb = Paths.AdbExe;
            if (string.IsNullOrEmpty(adb) || !File.Exists(adb))
            {
                result.Code = -1;
                result.Err = "adb.exe not found";
                return result;
            }

            StringBuilder stdout = new StringBuilder();
            StringBuilder stderr = new StringBuilder();
            Process p = null;
            try
            {
                ProcessStartInfo info = new ProcessStartInfo();
                info.FileName = adb;
                info.Arguments = args;
                info.WorkingDirectory = Path.GetDirectoryName(adb);
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                info.RedirectStandardOutput = true;
                info.RedirectStandardError = true;
                info.StandardOutputEncoding = Encoding.UTF8;
                info.StandardErrorEncoding = Encoding.UTF8;

                p = new Process();
                p.StartInfo = info;
                p.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null)
                    {
                        lock (stdout)
                        {
                            stdout.AppendLine(e.Data);
                        }
                    }
                };
                p.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null)
                    {
                        lock (stderr)
                        {
                            stderr.AppendLine(e.Data);
                        }
                    }
                };

                p.Start();
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                if (!p.WaitForExit(timeoutMs))
                {
                    result.TimedOut = true;
                    try
                    {
                        p.Kill();
                    }
                    catch
                    {
                    }
                    p.WaitForExit(1000);
                }
                else
                {
                    p.WaitForExit();
                }
                result.Code = p.HasExited ? p.ExitCode : -1;
            }
            catch (Exception ex)
            {
                result.Code = -1;
                result.Err = ex.Message;
            }
            finally
            {
                lock (stdout)
                {
                    result.Out = stdout.ToString();
                }
                lock (stderr)
                {
                    result.Err = stderr.ToString() + result.Err;
                }
                if (p != null)
                {
                    try
                    {
                        p.Dispose();
                    }
                    catch
                    {
                    }
                }
            }
            return result;
        }

        public static List<AdbDevice> Devices(out string error)
        {
            error = "";
            List<AdbDevice> devices = new List<AdbDevice>();
            AdbResult result = Run("devices -l", 8000);
            if (result.Code != 0 && result.Out.Trim().Length == 0)
            {
                error = result.Message.Length > 0 ? result.Message : "adb devices failed";
                return devices;
            }

            string[] lines = result.Out.Replace("\r", "").Split('\n');
            for (int i = 0; i < lines.Length; i++)
            {
                string line = lines[i].Trim();
                if (line.Length == 0 || line.StartsWith("List of devices"))
                {
                    continue;
                }
                string[] parts = line.Split(new char[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length < 2)
                {
                    continue;
                }
                AdbDevice device = new AdbDevice();
                device.Serial = parts[0];
                device.State = parts[1];
                for (int n = 2; n < parts.Length; n++)
                {
                    if (parts[n].StartsWith("model:", StringComparison.OrdinalIgnoreCase))
                    {
                        device.Model = parts[n].Substring(6);
                    }
                }
                devices.Add(device);
            }
            return devices;
        }

        public static AdbResult Reverse(string serial, int port)
        {
            return Run("-s " + serial + " reverse tcp:" + port.ToString() + " tcp:" + port.ToString(), 8000);
        }

        public static AdbResult OpenPhonePage(string serial, int port)
        {
            return Run("-s " + serial + " shell am start -a android.intent.action.VIEW -d http://127.0.0.1:" + port.ToString() + "/tx/", 9000);
        }
    }

    internal sealed class PhoneMonitor
    {
        private readonly object gate = new object();
        private bool busy;
        private bool autoOpened;
        private int reversePort;
        private string reverseSerial = "";
        private string status = "Looking for a phone...";
        private string serial = "";
        private string model = "";
        private bool ready;
        private bool tunnelReady;
        private bool unauthorized;

        public event EventHandler Changed;

        public string Status
        {
            get { lock (gate) { return status; } }
        }

        public string Serial
        {
            get { lock (gate) { return serial; } }
        }

        public string Model
        {
            get { lock (gate) { return model; } }
        }

        public bool Ready
        {
            get { lock (gate) { return ready; } }
        }

        public bool TunnelReady
        {
            get { lock (gate) { return tunnelReady; } }
        }

        public bool Unauthorized
        {
            get { lock (gate) { return unauthorized; } }
        }

        private void RaiseChanged()
        {
            EventHandler handler = Changed;
            if (handler != null)
            {
                try
                {
                    handler(this, EventArgs.Empty);
                }
                catch
                {
                }
            }
        }

        public void Reset()
        {
            lock (gate)
            {
                autoOpened = false;
                reversePort = 0;
                reverseSerial = "";
                tunnelReady = false;
            }
        }

        public void Poll(int port, bool serverRunning, bool openPhonePage)
        {
            lock (gate)
            {
                if (busy)
                {
                    return;
                }
                busy = true;
            }

            Task.Factory.StartNew(delegate
            {
                try
                {
                    Probe(port, serverRunning, openPhonePage);
                }
                catch (Exception ex)
                {
                    SetState("Phone check failed: " + ex.Message, "", "", false, false, false);
                }
                finally
                {
                    lock (gate)
                    {
                        busy = false;
                    }
                    RaiseChanged();
                }
            });
        }

        private void Probe(int port, bool serverRunning, bool openPhonePage)
        {
            if (string.IsNullOrEmpty(Paths.AdbExe) || !File.Exists(Paths.AdbExe))
            {
                SetState("adb.exe missing from the package", "", "", false, false, false);
                return;
            }

            string error;
            List<AdbDevice> devices = Adb.Devices(out error);
            if (!string.IsNullOrEmpty(error))
            {
                SetState("ADB error: " + error, "", "", false, false, false);
                return;
            }

            AdbDevice chosen = null;
            AdbDevice unauthorizedDevice = null;
            AdbDevice offlineDevice = null;
            for (int i = 0; i < devices.Count; i++)
            {
                AdbDevice d = devices[i];
                if (d.State == "device" && chosen == null)
                {
                    chosen = d;
                }
                else if (d.State == "unauthorized" && unauthorizedDevice == null)
                {
                    unauthorizedDevice = d;
                }
                else if (d.State == "offline" && offlineDevice == null)
                {
                    offlineDevice = d;
                }
            }

            if (chosen == null)
            {
                lock (gate)
                {
                    autoOpened = false;
                    reversePort = 0;
                    reverseSerial = "";
                    tunnelReady = false;
                }
                if (unauthorizedDevice != null)
                {
                    SetState("Phone detected - tap Allow on the USB debugging prompt", unauthorizedDevice.Serial, unauthorizedDevice.Model, false, false, true);
                }
                else if (offlineDevice != null)
                {
                    SetState("Phone is offline - unplug it and reconnect the cable", offlineDevice.Serial, offlineDevice.Model, false, false, false);
                }
                else
                {
                    SetState("No phone detected - plug in a data-capable USB cable", "", "", false, false, false);
                }
                return;
            }

            string label = chosen.Model.Length > 0 ? chosen.Model : chosen.Serial;
            if (!serverRunning)
            {
                SetState("Connected (" + label + ") - waiting for the local server", chosen.Serial, chosen.Model, true, false, false);
                return;
            }

            bool needsReverse = false;
            lock (gate)
            {
                needsReverse = reversePort != port || reverseSerial != chosen.Serial;
            }
            if (needsReverse)
            {
                Log.Write("launcher", "adb reverse tcp:" + port.ToString() + " for " + chosen.Serial);
                AdbResult reverse = Adb.Reverse(chosen.Serial, port);
                if (reverse.Code != 0)
                {
                    SetState("Connected (" + label + ") - USB tunnel failed: " + reverse.Message, chosen.Serial, chosen.Model, true, false, false);
                    return;
                }
                lock (gate)
                {
                    reversePort = port;
                    reverseSerial = chosen.Serial;
                    tunnelReady = true;
                }
                Log.Write("launcher", "USB tunnel ready for " + chosen.Serial);
            }

            bool shouldOpen = false;
            lock (gate)
            {
                tunnelReady = true;
                shouldOpen = openPhonePage && !autoOpened;
                if (shouldOpen)
                {
                    autoOpened = true;
                }
            }

            if (shouldOpen)
            {
                AdbResult opened = Adb.OpenPhonePage(chosen.Serial, port);
                if (opened.Code == 0)
                {
                    Log.Write("launcher", "opened phone transmitter page");
                    SetState("Ready (" + label + ") - transmitter page opened on the phone", chosen.Serial, chosen.Model, true, true, false);
                    return;
                }
                Log.Write("launcher", "phone page open failed: " + opened.Message);
                SetState("Ready (" + label + ") - open http://127.0.0.1:" + port.ToString() + "/tx/ on the phone", chosen.Serial, chosen.Model, true, true, false);
                return;
            }

            SetState("Ready (" + label + ") - USB tunnel active", chosen.Serial, chosen.Model, true, true, false);
        }

        private void SetState(string newStatus, string newSerial, string newModel, bool newReady, bool newTunnel, bool newUnauthorized)
        {
            lock (gate)
            {
                status = newStatus;
                serial = newSerial;
                model = newModel;
                ready = newReady;
                tunnelReady = newTunnel;
                unauthorized = newUnauthorized;
            }
        }
    }

    internal static class BrowserLauncher
    {
        public static string FindBrowser(out string name)
        {
            name = "";
            List<string> candidates = new List<string>();
            string pf = Environment.GetEnvironmentVariable("ProgramFiles");
            string pf86 = Environment.GetEnvironmentVariable("ProgramFiles(x86)");
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            if (!string.IsNullOrEmpty(pf))
            {
                candidates.Add(Path.Combine(pf, Path.Combine("Google", Path.Combine("Chrome", Path.Combine("Application", "chrome.exe")))));
                candidates.Add(Path.Combine(pf, Path.Combine("Microsoft", Path.Combine("Edge", Path.Combine("Application", "msedge.exe")))));
            }
            if (!string.IsNullOrEmpty(pf86))
            {
                candidates.Add(Path.Combine(pf86, Path.Combine("Google", Path.Combine("Chrome", Path.Combine("Application", "chrome.exe")))));
                candidates.Add(Path.Combine(pf86, Path.Combine("Microsoft", Path.Combine("Edge", Path.Combine("Application", "msedge.exe")))));
            }
            candidates.Add(Path.Combine(local, Path.Combine("Google", Path.Combine("Chrome", Path.Combine("Application", "chrome.exe")))));

            for (int i = 0; i < candidates.Count; i++)
            {
                if (File.Exists(candidates[i]))
                {
                    name = Path.GetFileNameWithoutExtension(candidates[i]) == "msedge" ? "Microsoft Edge" : "Google Chrome";
                    return candidates[i];
                }
            }
            return "";
        }

        public static string OpenSim(int port)
        {
            string url = "http://127.0.0.1:" + port.ToString() + "/sim/";
            try
            {
                string name;
                string browser = FindBrowser(out name);
                if (!string.IsNullOrEmpty(browser))
                {
                    string arguments = "--app=" + url +
                        " --user-data-dir=\"" + Paths.BrowserDataDir + "\"" +
                        " --no-first-run --no-default-browser-check --disable-session-crashed-bubble";
                    ProcessStartInfo info = new ProcessStartInfo();
                    info.FileName = browser;
                    info.Arguments = arguments;
                    info.UseShellExecute = false;
                    info.WorkingDirectory = Path.GetDirectoryName(browser);
                    Process.Start(info);
                    Log.Write("launcher", "opened sim in " + name + " app mode");
                    return "Opened in " + name + " app mode.";
                }

                ProcessStartInfo fallback = new ProcessStartInfo();
                fallback.FileName = url;
                fallback.UseShellExecute = true;
                Process.Start(fallback);
                Log.Write("launcher", "opened sim in default browser");
                return "Opened in your default browser. Install Chrome or Edge for app mode.";
            }
            catch (Exception ex)
            {
                Log.Write("launcher", "open sim failed: " + ex.Message);
                return "Could not open the simulator: " + ex.Message;
            }
        }
    }

    internal sealed class HelpForm : Form
    {
        private readonly ServerManager server;
        private readonly PhoneMonitor phone;
        private readonly bool firstRun;
        private readonly CheckBox dontShow;

        public HelpForm(ServerManager server, PhoneMonitor phone, bool firstRun)
        {
            this.server = server;
            this.phone = phone;
            this.firstRun = firstRun;

            Text = firstRun ? "Set up your phone" : "Phone setup";
            ClientSize = new Size(590, 510);
            BackColor = Color.FromArgb(9, 12, 16);
            ForeColor = Color.FromArgb(220, 230, 240);
            Font = new Font("Segoe UI", 9.5f);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterParent;
            ShowInTaskbar = false;
            Icon = AppIcon.Load();

            Label title = new Label();
            title.Text = firstRun ? "Set up your phone" : "Phone setup";
            title.Font = new Font("Segoe UI", 18f, FontStyle.Bold);
            title.ForeColor = Color.White;
            title.SetBounds(24, 20, 530, 36);
            Controls.Add(title);

            Label subtitle = new Label();
            subtitle.Text = "One cable. No app install. No internet.";
            subtitle.ForeColor = Color.FromArgb(130, 150, 170);
            subtitle.SetBounds(26, 58, 530, 24);
            Controls.Add(subtitle);

            TextBox steps = new TextBox();
            steps.Multiline = true;
            steps.ReadOnly = true;
            steps.BorderStyle = BorderStyle.None;
            steps.BackColor = Color.FromArgb(9, 12, 16);
            steps.ForeColor = Color.FromArgb(190, 205, 220);
            steps.Font = new Font("Segoe UI", 10f);
            steps.SetBounds(24, 100, 540, 290);
            steps.Text =
                "1.  On the Android phone, open Settings \u2192 About phone.\r\n" +
                "    Tap Build number seven times to unlock Developer options.\r\n\r\n" +
                "2.  Open Developer options and turn on USB debugging.\r\n\r\n" +
                "3.  Connect the phone to this laptop with a data-capable USB cable.\r\n" +
                "    Charge-only cables will not work.\r\n\r\n" +
                "4.  When the phone asks to allow USB debugging, tap Allow.\r\n" +
                "    Tick 'Always allow from this computer' if available.\r\n\r\n" +
                "5.  Wait for PHONE to turn green in the FPV window.\r\n" +
                "    The transmitter page opens on the phone automatically.\r\n\r\n" +
                "No phone? Click Open Simulator and fly with the keyboard.";
            Controls.Add(steps);

            dontShow = new CheckBox();
            dontShow.Text = firstRun ? "Don't show this on every launch" : "Don't show this again";
            dontShow.Checked = firstRun;
            dontShow.Visible = firstRun;
            dontShow.ForeColor = Color.FromArgb(160, 175, 190);
            dontShow.SetBounds(24, 400, 300, 24);
            Controls.Add(dontShow);

            Button copy = MakeButton("Copy diagnostics", 24, 438, 150, 34);
            copy.Click += delegate { CopyDiagnostics(); };
            Controls.Add(copy);

            Button logs = MakeButton("Open logs", 184, 438, 110, 34);
            logs.Click += delegate { OpenLogs(); };
            Controls.Add(logs);

            Button close = MakeButton("Start flying", 430, 438, 130, 34);
            close.BackColor = Color.FromArgb(53, 224, 138);
            close.ForeColor = Color.FromArgb(6, 17, 11);
            close.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            close.DialogResult = DialogResult.OK;
            Controls.Add(close);

            AcceptButton = close;
            CancelButton = close;
        }

        private static Button MakeButton(string text, int x, int y, int w, int h)
        {
            Button button = new Button();
            button.Text = text;
            button.SetBounds(x, y, w, h);
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderColor = Color.FromArgb(45, 56, 70);
            button.BackColor = Color.FromArgb(17, 23, 31);
            button.ForeColor = Color.FromArgb(220, 230, 240);
            button.Cursor = Cursors.Hand;
            return button;
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            if (firstRun)
            {
                try
                {
                    if (dontShow.Checked)
                    {
                        File.WriteAllText(Paths.WelcomeMarker, DateTime.Now.ToString("o"));
                    }
                    else if (File.Exists(Paths.WelcomeMarker))
                    {
                        File.Delete(Paths.WelcomeMarker);
                    }
                }
                catch
                {
                }
            }
            base.OnFormClosed(e);
        }

        private void CopyDiagnostics()
        {
            try
            {
                StringBuilder sb = new StringBuilder();
                sb.AppendLine(AppInfo.Product + " " + AppInfo.Version);
                sb.AppendLine("OS: " + Environment.OSVersion.VersionString + " 64-bit=" + Environment.Is64BitOperatingSystem);
                sb.AppendLine("Base: " + Paths.BaseDir);
                sb.AppendLine("Packaged: " + Paths.Packaged);
                sb.AppendLine("Node: " + Paths.NodeExe + " exists=" + File.Exists(Paths.NodeExe));
                sb.AppendLine("ADB: " + Paths.AdbExe + " exists=" + File.Exists(Paths.AdbExe));
                sb.AppendLine("Server: running=" + server.IsRunning + " port=" + server.Port + " error=" + server.Error);
                sb.AppendLine("Phone: " + phone.Status);
                HealthSnapshot health = server.Health;
                sb.AppendLine("Health: ok=" + health.Ok + " tx=" + health.Tx + " txHz=" + health.TxHz + " txs=" + health.Txs + " sims=" + health.Sims);
                sb.AppendLine("Logs: " + Paths.LogsDir);
                sb.AppendLine();
                sb.AppendLine("--- adb devices -l ---");
                if (!string.IsNullOrEmpty(Paths.AdbExe) && File.Exists(Paths.AdbExe))
                {
                    AdbResult result = Adb.Run("devices -l", 8000);
                    sb.AppendLine(result.Out);
                    if (result.Err.Length > 0)
                    {
                        sb.AppendLine(result.Err);
                    }
                }
                else
                {
                    sb.AppendLine("adb.exe not found");
                }
                Clipboard.SetText(sb.ToString());
                MessageBox.Show(this, "Diagnostics copied to the clipboard.", "FPV Rig", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "Could not copy diagnostics: " + ex.Message, "FPV Rig", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void OpenLogs()
        {
            try
            {
                Directory.CreateDirectory(Paths.LogsDir);
                Process.Start("explorer.exe", "\"" + Paths.LogsDir + "\"");
            }
            catch
            {
            }
        }
    }

    internal sealed class LauncherForm : Form
    {
        private const int EM_LINESCROLL = 0xB6;

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

        private readonly ServerManager server = new ServerManager();
        private readonly PhoneMonitor phone = new PhoneMonitor();
        private readonly System.Windows.Forms.Timer uiTimer = new System.Windows.Forms.Timer();
        private readonly System.Windows.Forms.Timer phoneTimer = new System.Windows.Forms.Timer();
        private readonly NotifyIcon tray = new NotifyIcon();
        private readonly Label serverDot;
        private readonly Label serverValue;
        private readonly Label phoneDot;
        private readonly Label phoneValue;
        private readonly Label simDot;
        private readonly Label simValue;
        private readonly LinkLabel phoneLink;
        private readonly TextBox activity;
        private readonly Button openSim;
        private readonly Button connectPhone;
        private readonly Button phonePage;
        private readonly Button setup;
        private readonly Button logs;
        private readonly Button exit;
        private bool reallyExit;
        private bool autoOpenDone;
        private bool pendingOpen;
        private bool simLaunched;
        private bool trayHintShown;
        private string lastActivity = "";

        public LauncherForm()
        {
            Text = AppInfo.Product;
            ClientSize = new Size(660, 566);
            BackColor = Color.FromArgb(9, 12, 16);
            ForeColor = Color.FromArgb(220, 230, 240);
            Font = new Font("Segoe UI", 9.5f);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            Icon = AppIcon.Load();

            Label title = new Label();
            title.Text = "FPV RIG";
            title.Font = new Font("Segoe UI", 22f, FontStyle.Bold);
            title.ForeColor = Color.White;
            title.SetBounds(24, 16, 320, 42);
            Controls.Add(title);

            Label tagline = new Label();
            tagline.Text = AppInfo.Tagline;
            tagline.ForeColor = Color.FromArgb(130, 150, 170);
            tagline.SetBounds(26, 58, 500, 22);
            Controls.Add(tagline);

            Label version = new Label();
            version.Text = "v" + AppInfo.Version;
            version.TextAlign = ContentAlignment.MiddleRight;
            version.ForeColor = Color.FromArgb(95, 112, 130);
            version.SetBounds(548, 26, 84, 20);
            Controls.Add(version);

            Panel statusPanel = new Panel();
            statusPanel.BackColor = Color.FromArgb(15, 20, 27);
            statusPanel.BorderStyle = BorderStyle.FixedSingle;
            statusPanel.SetBounds(24, 94, 612, 142);
            Controls.Add(statusPanel);

            serverDot = AddStatusRow(statusPanel, 18, "SERVER", "Starting...", out serverValue);
            phoneDot = AddStatusRow(statusPanel, 50, "PHONE", "Looking for a phone...", out phoneValue);
            simDot = AddStatusRow(statusPanel, 82, "SIMULATOR", "Not open", out simValue);

            Label urlName = new Label();
            urlName.Text = "PHONE URL";
            urlName.ForeColor = Color.FromArgb(110, 128, 146);
            urlName.Font = new Font("Segoe UI", 8f, FontStyle.Bold);
            urlName.SetBounds(16, 116, 92, 18);
            statusPanel.Controls.Add(urlName);

            phoneLink = new LinkLabel();
            phoneLink.Text = "Start the local server first";
            phoneLink.LinkColor = Color.FromArgb(53, 224, 138);
            phoneLink.ActiveLinkColor = Color.White;
            phoneLink.VisitedLinkColor = Color.FromArgb(53, 224, 138);
            phoneLink.SetBounds(116, 114, 460, 20);
            phoneLink.LinkClicked += delegate { OpenPhonePage(); };
            statusPanel.Controls.Add(phoneLink);

            FlowLayoutPanel actions = new FlowLayoutPanel();
            actions.FlowDirection = FlowDirection.LeftToRight;
            actions.WrapContents = false;
            actions.SetBounds(24, 248, 612, 42);
            actions.BackColor = Color.Transparent;
            Controls.Add(actions);

            openSim = MakeButton("Open Simulator", 148, 36);
            openSim.BackColor = Color.FromArgb(53, 224, 138);
            openSim.ForeColor = Color.FromArgb(6, 17, 11);
            openSim.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            openSim.Click += delegate { OpenSimulator(); };
            actions.Controls.Add(openSim);

            connectPhone = MakeButton("Connect", 92, 36);
            connectPhone.Click += delegate { ConnectPhone(); };
            actions.Controls.Add(connectPhone);

            phonePage = MakeButton("Phone page", 104, 36);
            phonePage.Click += delegate { OpenPhonePage(); };
            actions.Controls.Add(phonePage);

            setup = MakeButton("Setup", 76, 36);
            setup.Click += delegate { ShowSetup(false); };
            actions.Controls.Add(setup);

            logs = MakeButton("Logs", 68, 36);
            logs.Click += delegate { OpenLogs(); };
            actions.Controls.Add(logs);

            Label activityTitle = new Label();
            activityTitle.Text = "ACTIVITY";
            activityTitle.ForeColor = Color.FromArgb(110, 128, 146);
            activityTitle.Font = new Font("Segoe UI", 8f, FontStyle.Bold);
            activityTitle.SetBounds(26, 302, 200, 18);
            Controls.Add(activityTitle);

            activity = new TextBox();
            activity.Multiline = true;
            activity.ReadOnly = true;
            activity.ScrollBars = ScrollBars.Both;
            activity.WordWrap = false;
            activity.BorderStyle = BorderStyle.FixedSingle;
            activity.BackColor = Color.FromArgb(6, 8, 11);
            activity.ForeColor = Color.FromArgb(160, 178, 195);
            activity.Font = new Font("Consolas", 8.5f);
            activity.SetBounds(24, 322, 612, 198);
            activity.Text = "Starting the local server...\r\n";
            Controls.Add(activity);

            Label footer = new Label();
            footer.Text = "Runs locally. No accounts. No internet.";
            footer.ForeColor = Color.FromArgb(95, 112, 130);
            footer.SetBounds(26, 534, 470, 20);
            Controls.Add(footer);

            exit = MakeButton("Exit", 88, 30);
            exit.SetBounds(548, 528, 88, 30);
            exit.Click += delegate { ExitApplication(); };
            Controls.Add(exit);

            uiTimer.Interval = 600;
            uiTimer.Tick += delegate { UpdateUi(); };
            phoneTimer.Interval = 2200;
            phoneTimer.Tick += delegate { PollPhone(); };

            server.Changed += delegate { SafeUi(); };
            phone.Changed += delegate { SafeUi(); };

            tray.Icon = AppIcon.Load();
            tray.Text = AppInfo.Product;
            tray.Visible = true;
            tray.DoubleClick += delegate { RestoreWindow(); };
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("Open FPV", null, delegate { RestoreWindow(); });
            menu.Items.Add("Open Simulator", null, delegate { OpenSimulator(); });
            menu.Items.Add("Phone setup", null, delegate { ShowSetup(false); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Exit", null, delegate { ExitApplication(); });
            tray.ContextMenuStrip = menu;

            Load += delegate
            {
                Paths.Discover();
                Log.Init();
                Log.Write("launcher", "base=" + Paths.BaseDir + " packaged=" + Paths.Packaged);
                Log.Write("launcher", "node=" + Paths.NodeExe + " adb=" + Paths.AdbExe);
                uiTimer.Start();
                phoneTimer.Start();
                StartServer();
                if (!File.Exists(Paths.WelcomeMarker))
                {
                    BeginInvoke(new Action(delegate { ShowSetup(true); }));
                }
            };
            FormClosing += delegate(object sender, FormClosingEventArgs e)
            {
                if (!reallyExit)
                {
                    if (server.IsRunning || server.IsStarting)
                    {
                        e.Cancel = true;
                        Hide();
                        if (!trayHintShown)
                        {
                            trayHintShown = true;
                            tray.ShowBalloonTip(4000, "FPV Rig is still running", "The local server is in the tray. Double-click the icon to reopen, or use Exit to stop it.", ToolTipIcon.Info);
                        }
                        return;
                    }
                }
                reallyExit = true;
                uiTimer.Stop();
                phoneTimer.Stop();
                tray.Visible = false;
                tray.Dispose();
                server.Dispose();
            };
            Resize += delegate
            {
                if (WindowState == FormWindowState.Minimized)
                {
                    Hide();
                }
            };
            Shown += delegate { UpdateUi(); };
        }

        private static Label AddStatusRow(Panel panel, int y, string name, string value, out Label valueLabel)
        {
            Label dot = new Label();
            dot.Text = "\u25CF";
            dot.Font = new Font("Segoe UI", 12f);
            dot.ForeColor = Color.FromArgb(105, 120, 136);
            dot.SetBounds(14, y - 3, 20, 22);
            panel.Controls.Add(dot);

            Label nameLabel = new Label();
            nameLabel.Text = name;
            nameLabel.ForeColor = Color.FromArgb(110, 128, 146);
            nameLabel.Font = new Font("Segoe UI", 8f, FontStyle.Bold);
            nameLabel.SetBounds(40, y, 92, 20);
            panel.Controls.Add(nameLabel);

            valueLabel = new Label();
            valueLabel.Text = value;
            valueLabel.ForeColor = Color.FromArgb(218, 228, 238);
            valueLabel.SetBounds(134, y - 1, 460, 22);
            valueLabel.AutoEllipsis = true;
            panel.Controls.Add(valueLabel);
            return dot;
        }

        private static Button MakeButton(string text, int width, int height)
        {
            Button button = new Button();
            button.Text = text;
            button.Size = new Size(width, height);
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderColor = Color.FromArgb(45, 56, 70);
            button.BackColor = Color.FromArgb(17, 23, 31);
            button.ForeColor = Color.FromArgb(220, 230, 240);
            button.Cursor = Cursors.Hand;
            return button;
        }

        private void SafeUi()
        {
            try
            {
                if (IsDisposed)
                {
                    return;
                }
                if (InvokeRequired)
                {
                    BeginInvoke(new Action(UpdateUi));
                }
                else
                {
                    UpdateUi();
                }
            }
            catch
            {
            }
        }

        private void StartServer()
        {
            if (server.IsRunning || server.IsStarting)
            {
                return;
            }
            SetDot(serverDot, Color.FromArgb(230, 180, 70));
            serverValue.Text = "Starting local server...";
            Task.Factory.StartNew(delegate
            {
                server.Start();
                SafeUi();
            });
        }

        private void OpenSimulator()
        {
            if (!server.IsRunning)
            {
                pendingOpen = true;
                if (!server.IsStarting)
                {
                    StartServer();
                }
                return;
            }
            string result = BrowserLauncher.OpenSim(server.Port);
            simLaunched = true;
            Log.Write("launcher", result);
            pendingOpen = false;
            SafeUi();
        }

        private void ConnectPhone()
        {
            if (string.IsNullOrEmpty(Paths.AdbExe) || !File.Exists(Paths.AdbExe))
            {
                ShowSetup(false);
                return;
            }
            Log.Write("launcher", "manual phone check");
            PollPhone();
        }

        private void OpenPhonePage()
        {
            if (!server.IsRunning)
            {
                MessageBox.Show(this, "Start the local server first.", AppInfo.Product, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            string serial = phone.Serial;
            if (string.IsNullOrEmpty(serial))
            {
                MessageBox.Show(this, "No phone is ready yet.\r\n\r\nPlug in a data-capable USB cable, enable USB debugging, and tap Allow on the phone.", AppInfo.Product, MessageBoxButtons.OK, MessageBoxIcon.Information);
                PollPhone();
                return;
            }
            AdbResult result = Adb.OpenPhonePage(serial, server.Port);
            if (result.Code == 0)
            {
                Log.Write("launcher", "phone page opened on " + serial);
            }
            else
            {
                Log.Write("launcher", "phone page failed: " + result.Message);
                MessageBox.Show(this, "Could not open the phone page: " + result.Message, AppInfo.Product, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void PollPhone()
        {
            if (server.IsStarting)
            {
                return;
            }
            phone.Poll(server.Port, server.IsRunning, true);
        }

        private void UpdateUi()
        {
            int port = server.Port;
            bool running = server.IsRunning;
            bool starting = server.IsStarting;
            HealthSnapshot health = server.Health;

            if (running)
            {
                SetDot(serverDot, Color.FromArgb(53, 224, 138));
                serverValue.Text = "Running on 127.0.0.1:" + port.ToString() + (health.Ok ? "" : " - health check retrying");
            }
            else if (starting)
            {
                SetDot(serverDot, Color.FromArgb(230, 180, 70));
                serverValue.Text = "Starting local server...";
            }
            else
            {
                SetDot(serverDot, Color.FromArgb(220, 80, 80));
                string error = server.Error;
                serverValue.Text = "Stopped" + (error.Length > 0 ? " - " + error : "");
            }

            if (phone.Unauthorized)
            {
                SetDot(phoneDot, Color.FromArgb(230, 180, 70));
            }
            else if (phone.Ready && phone.TunnelReady)
            {
                SetDot(phoneDot, Color.FromArgb(53, 224, 138));
            }
            else if (phone.Ready)
            {
                SetDot(phoneDot, Color.FromArgb(230, 180, 70));
            }
            else
            {
                SetDot(phoneDot, Color.FromArgb(105, 120, 136));
            }
            phoneValue.Text = phone.Status;

            if (health.Ok && health.Sims > 0)
            {
                SetDot(simDot, Color.FromArgb(53, 224, 138));
                simValue.Text = "Open - " + health.Sims.ToString() + " connected";
            }
            else if (simLaunched)
            {
                SetDot(simDot, Color.FromArgb(230, 180, 70));
                simValue.Text = "Launched - waiting for the sim to connect";
            }
            else
            {
                SetDot(simDot, Color.FromArgb(105, 120, 136));
                simValue.Text = "Not open";
            }

            if (running)
            {
                phoneLink.Text = "http://127.0.0.1:" + port.ToString() + "/tx/";
                phoneLink.Enabled = true;
            }
            else
            {
                phoneLink.Text = "Start the local server first";
                phoneLink.Enabled = false;
            }

            openSim.Enabled = !starting || running;
            connectPhone.Enabled = !server.IsStarting;
            phonePage.Enabled = running && phone.Ready;

            string tail = Log.Tail(Paths.ServerLog, 180);
            if (tail.Length == 0)
            {
                tail = "No server activity yet.\r\n";
            }
            if (tail != lastActivity)
            {
                lastActivity = tail;
                activity.Text = tail;
                if (activity.IsHandleCreated)
                {
                    SendMessage(activity.Handle, EM_LINESCROLL, IntPtr.Zero, (IntPtr)activity.Lines.Length);
                }
            }

            if (running && pendingOpen && !autoOpenDone)
            {
                autoOpenDone = true;
                pendingOpen = false;
                OpenSimulator();
            }
            else if (running && !autoOpenDone && !starting)
            {
                autoOpenDone = true;
                OpenSimulator();
            }
        }

        private static void SetDot(Label dot, Color color)
        {
            if (dot.ForeColor != color)
            {
                dot.ForeColor = color;
            }
        }

        private void ShowSetup(bool firstRun)
        {
            using (HelpForm form = new HelpForm(server, phone, firstRun))
            {
                form.ShowDialog(this);
            }
        }

        private void OpenLogs()
        {
            try
            {
                Directory.CreateDirectory(Paths.LogsDir);
                Process.Start("explorer.exe", "\"" + Paths.LogsDir + "\"");
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "Could not open the log folder: " + ex.Message, AppInfo.Product, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void RestoreWindow()
        {
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
        }

        private void ExitApplication()
        {
            reallyExit = true;
            uiTimer.Stop();
            phoneTimer.Stop();
            tray.Visible = false;
            server.Stop();
            Close();
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            bool created;
            using (Mutex mutex = new Mutex(true, "Local\\FpvRigLauncher", out created))
            {
                if (!created)
                {
                    MessageBox.Show("FPV Rig is already running. Look for it in the system tray.", AppInfo.Product, MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new LauncherForm());
            }
        }
    }
}
