using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("FPV Rig Setup")]
[assembly: AssemblyDescription("FPV Rig installer")]
[assembly: AssemblyProduct("FPV Rig")]
[assembly: AssemblyCompany("Mitrakulal")]
[assembly: AssemblyVersion("0.3.0.0")]
[assembly: AssemblyFileVersion("0.3.0.0")]

namespace FpvSetup
{
    internal sealed class InstallerForm : Form
    {
        private readonly CheckBox desktopShortcut;
        private readonly CheckBox launchApp;
        private readonly Button installButton;
        private readonly Button cancelButton;
        private readonly ProgressBar progress;
        private readonly Label status;
        private bool installing;

        public InstallerForm()
        {
            Text = "FPV Rig Setup";
            ClientSize = new Size(620, 430);
            BackColor = Color.FromArgb(9, 12, 16);
            ForeColor = Color.FromArgb(220, 230, 240);
            Font = new Font("Segoe UI", 9.5f);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            try
            {
                Icon appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (appIcon != null)
                {
                    Icon = appIcon;
                }
            }
            catch
            {
            }

            Label title = new Label();
            title.Text = "FPV RIG SETUP";
            title.Font = new Font("Segoe UI", 22f, FontStyle.Bold);
            title.ForeColor = Color.White;
            title.SetBounds(24, 18, 420, 42);
            Controls.Add(title);

            Label subtitle = new Label();
            subtitle.Text = "Offline simulator. Phone as transmitter. No admin rights needed.";
            subtitle.ForeColor = Color.FromArgb(130, 150, 170);
            subtitle.SetBounds(26, 60, 540, 22);
            Controls.Add(subtitle);

            Label version = new Label();
            version.Text = "v" + InstallInfo.Version;
            version.TextAlign = ContentAlignment.MiddleRight;
            version.ForeColor = Color.FromArgb(95, 112, 130);
            version.SetBounds(512, 28, 84, 20);
            Controls.Add(version);

            Panel info = new Panel();
            info.BackColor = Color.FromArgb(15, 20, 27);
            info.BorderStyle = BorderStyle.FixedSingle;
            info.SetBounds(24, 102, 572, 126);
            Controls.Add(info);

            Label infoTitle = new Label();
            infoTitle.Text = "WHAT WILL BE INSTALLED";
            infoTitle.ForeColor = Color.FromArgb(110, 128, 146);
            infoTitle.Font = new Font("Segoe UI", 8f, FontStyle.Bold);
            infoTitle.SetBounds(16, 12, 260, 18);
            info.Controls.Add(infoTitle);

            Label location = new Label();
            location.Text = "FPV Rig, its bundled Node runtime, assets and ADB helper.";
            location.ForeColor = Color.FromArgb(205, 216, 228);
            location.SetBounds(16, 34, 520, 20);
            info.Controls.Add(location);

            Label folder = new Label();
            folder.Text = InstallInfo.InstallDir;
            folder.ForeColor = Color.FromArgb(120, 138, 156);
            folder.AutoEllipsis = true;
            folder.SetBounds(16, 58, 532, 20);
            info.Controls.Add(folder);

            Label settings = new Label();
            settings.Text = "Settings and logs: " + InstallInfo.DataDir;
            settings.ForeColor = Color.FromArgb(120, 138, 156);
            settings.AutoEllipsis = true;
            settings.SetBounds(16, 82, 532, 20);
            info.Controls.Add(settings);

            Label local = new Label();
            local.Text = "Everything stays local. No account, no internet.";
            local.ForeColor = Color.FromArgb(120, 138, 156);
            local.SetBounds(16, 102, 532, 20);
            info.Controls.Add(local);

            desktopShortcut = new CheckBox();
            desktopShortcut.Text = "Create a desktop shortcut";
            desktopShortcut.Checked = true;
            desktopShortcut.ForeColor = Color.FromArgb(200, 212, 224);
            desktopShortcut.SetBounds(26, 246, 280, 24);
            Controls.Add(desktopShortcut);

            launchApp = new CheckBox();
            launchApp.Text = "Open FPV Rig after installing";
            launchApp.Checked = true;
            launchApp.ForeColor = Color.FromArgb(200, 212, 224);
            launchApp.SetBounds(26, 274, 280, 24);
            Controls.Add(launchApp);

            progress = new ProgressBar();
            progress.SetBounds(24, 314, 572, 6);
            progress.Style = ProgressBarStyle.Marquee;
            progress.MarqueeAnimationSpeed = 26;
            progress.Visible = false;
            Controls.Add(progress);

            status = new Label();
            status.Text = "Ready to install for this Windows user.";
            status.ForeColor = Color.FromArgb(145, 162, 180);
            status.SetBounds(24, 330, 572, 22);
            Controls.Add(status);

            installButton = new Button();
            installButton.Text = "Install FPV Rig";
            installButton.SetBounds(424, 370, 172, 38);
            installButton.FlatStyle = FlatStyle.Flat;
            installButton.FlatAppearance.BorderColor = Color.FromArgb(53, 224, 138);
            installButton.BackColor = Color.FromArgb(53, 224, 138);
            installButton.ForeColor = Color.FromArgb(6, 17, 11);
            installButton.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            installButton.Cursor = Cursors.Hand;
            installButton.Click += delegate { BeginInstall(); };
            Controls.Add(installButton);

            cancelButton = new Button();
            cancelButton.Text = "Cancel";
            cancelButton.SetBounds(322, 370, 92, 38);
            cancelButton.FlatStyle = FlatStyle.Flat;
            cancelButton.FlatAppearance.BorderColor = Color.FromArgb(45, 56, 70);
            cancelButton.BackColor = Color.FromArgb(17, 23, 31);
            cancelButton.ForeColor = Color.FromArgb(220, 230, 240);
            cancelButton.Cursor = Cursors.Hand;
            cancelButton.Click += delegate { Close(); };
            Controls.Add(cancelButton);

            AcceptButton = installButton;
            CancelButton = cancelButton;
        }

        private void BeginInstall()
        {
            if (installing)
            {
                return;
            }
            installing = true;
            installButton.Enabled = false;
            cancelButton.Enabled = false;
            desktopShortcut.Enabled = false;
            launchApp.Enabled = false;
            progress.Visible = true;
            status.Text = "Preparing...";

            bool desktop = desktopShortcut.Checked;
            bool launch = launchApp.Checked;
            string target = InstallInfo.InstallDir;

            Task.Factory.StartNew(delegate
            {
                try
                {
                    InstallCommon.Install(target, desktop, launch, delegate(string message)
                    {
                        try
                        {
                            BeginInvoke(new Action(delegate { status.Text = message; }));
                        }
                        catch
                        {
                        }
                    });
                    try
                    {
                        BeginInvoke(new Action(delegate
                        {
                            progress.Visible = false;
                            if (launch)
                            {
                                status.Text = "Installed. Opening FPV Rig...";
                                installing = false;
                                Close();
                                return;
                            }
                            status.Text = "Installed. FPV Rig is ready.";
                            installButton.Visible = false;
                            cancelButton.Text = "Close";
                            cancelButton.Enabled = true;
                            installing = false;
                        }));
                    }
                    catch
                    {
                    }
                }
                catch (Exception ex)
                {
                    try
                    {
                        BeginInvoke(new Action(delegate
                        {
                            progress.Visible = false;
                            status.Text = "Install failed.";
                            installing = false;
                            installButton.Enabled = true;
                            cancelButton.Enabled = true;
                            desktopShortcut.Enabled = true;
                            launchApp.Enabled = true;
                            MessageBox.Show(this, "FPV Rig could not be installed:\r\n\r\n" + ex.Message, "FPV Rig Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        }));
                    }
                    catch
                    {
                    }
                }
            });
        }
    }

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            bool silent = false;
            for (int i = 0; i < args.Length; i++)
            {
                if (string.Equals(args[i], "/silent", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(args[i], "/s", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(args[i], "--silent", StringComparison.OrdinalIgnoreCase))
                {
                    silent = true;
                }
            }

            if (silent)
            {
                try
                {
                    InstallCommon.Install(InstallInfo.InstallDir, true, false, null);
                    return 0;
                }
                catch (Exception ex)
                {
                    try
                    {
                        File.WriteAllText(Path.Combine(Path.GetTempPath(), "FPV-install-error.txt"), ex.ToString());
                    }
                    catch
                    {
                    }
                    return 1;
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
            return 0;
        }
    }
}
