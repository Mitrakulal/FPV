using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

namespace FpvSetup
{
    internal static class InstallInfo
    {
        public const string Product = "FPV Rig";
        public const string Version = "0.2.0";
        public const string Publisher = "Mitrakulal";
        public const string RegistryKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\FPV Rig";

        public static string InstallDir
        {
            get
            {
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Path.Combine("Programs", "FPV Rig"));
            }
        }

        public static string DataDir
        {
            get
            {
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FPV");
            }
        }

        public static string StartMenuLink
        {
            get
            {
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "FPV Rig.lnk");
            }
        }

        public static string DesktopLink
        {
            get
            {
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "FPV Rig.lnk");
            }
        }

        public static string UninstallLink
        {
            get
            {
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Uninstall FPV Rig.lnk");
            }
        }
    }

    internal static class InstallCommon
    {
        public static void Install(string target, bool desktopShortcut, bool launch, Action<string> status)
        {
            if (status == null)
            {
                status = delegate { };
            }

            status("Closing any running copy...");
            CloseRunningApp(target);

            status("Preparing the install folder...");
            DeleteDirectoryWithRetry(target, 8);
            Directory.CreateDirectory(target);

            status("Unpacking the simulator...");
            ExtractPayload(target, status);

            string portable = Path.Combine(target, "portable.txt");
            if (File.Exists(portable))
            {
                File.Delete(portable);
            }

            status("Creating shortcuts...");
            CreateShortcuts(target, desktopShortcut);

            status("Registering the app...");
            WriteUninstallRegistry(target);

            status("Installed successfully.");
            if (launch)
            {
                Process.Start(new ProcessStartInfo(Path.Combine(target, "FPV.exe")) { UseShellExecute = true, WorkingDirectory = target });
            }
        }

        public static void Uninstall(string target, bool removeData)
        {
            CloseRunningApp(target);
            DeleteShortcuts();
            RemoveUninstallRegistry();
            if (removeData)
            {
                DeleteDirectoryWithRetry(InstallInfo.DataDir, 4);
            }
            ScheduleDirectoryRemoval(target, removeData);
        }

        private static void ExtractPayload(string target, Action<string> status)
        {
            Assembly assembly = Assembly.GetExecutingAssembly();
            Stream stream = assembly.GetManifestResourceStream("payload.zip");
            if (stream == null)
            {
                throw new InvalidOperationException("The installer payload is missing.");
            }

            string root = Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            int count = 0;
            using (stream)
            using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
            {
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    string destination = Path.GetFullPath(Path.Combine(root, entry.FullName));
                    if (!destination.StartsWith(root, StringComparison.OrdinalIgnoreCase) && !destination.Equals(root.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidOperationException("The installer payload contains an invalid path.");
                    }

                    if (entry.FullName.EndsWith("/", StringComparison.Ordinal) || entry.Name.Length == 0)
                    {
                        Directory.CreateDirectory(destination);
                        continue;
                    }

                    Directory.CreateDirectory(Path.GetDirectoryName(destination));
                    entry.ExtractToFile(destination, true);
                    count++;
                    if ((count % 80) == 0)
                    {
                        status("Unpacking the simulator... " + count.ToString() + " files");
                    }
                }
            }
            status("Unpacked " + count.ToString() + " files.");
        }

        public static void CloseRunningApp(string target)
        {
            string fpv = Path.GetFullPath(Path.Combine(target, "FPV.exe"));
            string node = Path.GetFullPath(Path.Combine(target, Path.Combine("node", "node.exe")));
            List<int> ids = new List<int>();

            Process[] processes = Process.GetProcessesByName("FPV");
            for (int i = 0; i < processes.Length; i++)
            {
                Process p = processes[i];
                try
                {
                    if (string.Equals(Path.GetFullPath(p.MainModule.FileName), fpv, StringComparison.OrdinalIgnoreCase))
                    {
                        ids.Add(p.Id);
                    }
                }
                catch
                {
                }
                finally
                {
                    p.Dispose();
                }
            }

            processes = Process.GetProcessesByName("node");
            for (int i = 0; i < processes.Length; i++)
            {
                Process p = processes[i];
                try
                {
                    if (string.Equals(Path.GetFullPath(p.MainModule.FileName), node, StringComparison.OrdinalIgnoreCase))
                    {
                        ids.Add(p.Id);
                    }
                }
                catch
                {
                }
                finally
                {
                    p.Dispose();
                }
            }

            for (int i = 0; i < ids.Count; i++)
            {
                RunTaskKill(ids[i]);
            }
            if (ids.Count > 0)
            {
                Thread.Sleep(900);
            }
        }

        private static void RunTaskKill(int pid)
        {
            try
            {
                ProcessStartInfo info = new ProcessStartInfo();
                info.FileName = "taskkill.exe";
                info.Arguments = "/PID " + pid.ToString() + " /T /F";
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                info.RedirectStandardOutput = true;
                info.RedirectStandardError = true;
                using (Process p = Process.Start(info))
                {
                    if (p != null)
                    {
                        p.WaitForExit(4000);
                    }
                }
            }
            catch
            {
            }
        }

        public static void CreateShortcuts(string target, bool desktopShortcut)
        {
            string exe = Path.Combine(target, "FPV.exe");
            string uninstall = Path.Combine(target, "Uninstall.exe");
            CreateShortcut(InstallInfo.StartMenuLink, exe, target, exe, "FPV Rig flight simulator");
            DeleteFile(InstallInfo.UninstallLink);
            if (File.Exists(uninstall))
            {
                CreateShortcut(InstallInfo.UninstallLink, uninstall, target, uninstall, "Uninstall FPV Rig");
            }
            if (desktopShortcut)
            {
                CreateShortcut(InstallInfo.DesktopLink, exe, target, exe, "FPV Rig flight simulator");
            }
            else
            {
                DeleteFile(InstallInfo.DesktopLink);
            }
        }

        public static void DeleteShortcuts()
        {
            DeleteFile(InstallInfo.StartMenuLink);
            DeleteFile(InstallInfo.DesktopLink);
            DeleteFile(InstallInfo.UninstallLink);
        }

        public static void CreateShortcut(string linkPath, string targetPath, string workingDirectory, string iconPath, string description)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null)
            {
                throw new InvalidOperationException("Windows Script Host is not available, so shortcuts could not be created.");
            }

            Directory.CreateDirectory(Path.GetDirectoryName(linkPath));
            object shell = Activator.CreateInstance(shellType);
            object shortcut = null;
            try
            {
                shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { linkPath });
                Type type = shortcut.GetType();
                type.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetPath });
                type.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDirectory });
                type.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { iconPath + ",0" });
                type.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { description });
                type.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, new object[] { });
            }
            finally
            {
                if (shortcut != null && Marshal.IsComObject(shortcut))
                {
                    Marshal.ReleaseComObject(shortcut);
                }
                if (shell != null && Marshal.IsComObject(shell))
                {
                    Marshal.ReleaseComObject(shell);
                }
            }
        }

        public static void WriteUninstallRegistry(string target)
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(InstallInfo.RegistryKey))
            {
                string exe = Path.Combine(target, "FPV.exe");
                string uninstall = Path.Combine(target, "Uninstall.exe");
                key.SetValue("DisplayName", InstallInfo.Product);
                key.SetValue("DisplayVersion", InstallInfo.Version);
                key.SetValue("Publisher", InstallInfo.Publisher);
                key.SetValue("InstallLocation", target);
                key.SetValue("DisplayIcon", exe + ",0");
                key.SetValue("UninstallString", "\"" + uninstall + "\"");
                key.SetValue("QuietUninstallString", "\"" + uninstall + "\" /silent");
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                key.SetValue("EstimatedSize", EstimateSizeKb(target), RegistryValueKind.DWord);
            }
        }

        public static void RemoveUninstallRegistry()
        {
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(InstallInfo.RegistryKey, false);
            }
            catch
            {
            }
        }

        private static int EstimateSizeKb(string target)
        {
            try
            {
                long bytes = 0;
                string[] files = Directory.GetFiles(target, "*", SearchOption.AllDirectories);
                for (int i = 0; i < files.Length; i++)
                {
                    try
                    {
                        bytes += new FileInfo(files[i]).Length;
                    }
                    catch
                    {
                    }
                }
                long kb = bytes / 1024;
                return kb > int.MaxValue ? int.MaxValue : (int)kb;
            }
            catch
            {
                return 0;
            }
        }

        private static void DeleteFile(string path)
        {
            try
            {
                if (File.Exists(path))
                {
                    File.Delete(path);
                }
            }
            catch
            {
            }
        }

        public static void DeleteDirectoryWithRetry(string path, int attempts)
        {
            if (!Directory.Exists(path))
            {
                return;
            }
            for (int i = 0; i < attempts; i++)
            {
                try
                {
                    Directory.Delete(path, true);
                    return;
                }
                catch
                {
                    Thread.Sleep(350);
                }
            }
        }

        public static void ScheduleDirectoryRemoval(string target, bool removeData)
        {
            try
            {
                string batch = Path.Combine(Path.GetTempPath(), "fpv-uninstall-" + Guid.NewGuid().ToString("N") + ".cmd");
                StringBuilder text = new StringBuilder();
                text.AppendLine("@echo off");
                text.AppendLine("setlocal");
                text.AppendLine("ping 127.0.0.1 -n 2 >nul");
                text.AppendLine("for /l %%i in (1,1,20) do (");
                text.AppendLine("  if not exist \"" + target + "\" goto done");
                text.AppendLine("  rmdir /s /q \"" + target + "\" >nul 2>nul");
                text.AppendLine("  if not exist \"" + target + "\" goto done");
                text.AppendLine("  ping 127.0.0.1 -n 2 >nul");
                text.AppendLine(")");
                text.AppendLine(":done");
                if (removeData)
                {
                    text.AppendLine("rmdir /s /q \"" + InstallInfo.DataDir + "\" >nul 2>nul");
                }
                text.AppendLine("del /f /q \"%~f0\" >nul 2>nul");
                File.WriteAllText(batch, text.ToString(), Encoding.Default);

                ProcessStartInfo info = new ProcessStartInfo();
                info.FileName = "cmd.exe";
                info.Arguments = "/c \"\"" + batch + "\"\"";
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                info.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(info);
            }
            catch
            {
            }
        }
    }
}
