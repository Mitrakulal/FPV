using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("FPV Rig Uninstall")]
[assembly: AssemblyDescription("FPV Rig uninstaller")]
[assembly: AssemblyProduct("FPV Rig")]
[assembly: AssemblyCompany("Mitrakulal")]
[assembly: AssemblyVersion("0.3.1.0")]
[assembly: AssemblyFileVersion("0.3.1.0")]

namespace FpvSetup
{
    internal sealed class UninstallForm : Form
    {
        private readonly CheckBox removeData;
        private readonly Button uninstallButton;
        private readonly Button cancelButton;
        private readonly Label status;
        private bool working;

        public UninstallForm()
        {
            Text = "Uninstall FPV Rig";
            ClientSize = new Size(540, 318);
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
            title.Text = "Uninstall FPV Rig";
            title.Font = new Font("Segoe UI", 20f, FontStyle.Bold);
            title.ForeColor = Color.White;
            title.SetBounds(24, 18, 460, 38);
            Controls.Add(title);

            Label body = new Label();
            body.Text = "This removes the app, shortcuts and the Windows uninstall entry.\r\n\r\n" +
                "Your settings, logs and browser profile are kept unless you choose to remove them.";
            body.ForeColor = Color.FromArgb(155, 172, 190);
            body.SetBounds(26, 72, 490, 72);
            Controls.Add(body);

            removeData = new CheckBox();
            removeData.Text = "Also remove settings, logs and the browser profile";
            removeData.Checked = false;
            removeData.ForeColor = Color.FromArgb(200, 212, 224);
            removeData.SetBounds(26, 164, 490, 24);
            Controls.Add(removeData);

            status = new Label();
            status.Text = "FPV Rig is installed for this Windows user.";
            status.ForeColor = Color.FromArgb(125, 143, 161);
            status.SetBounds(26, 198, 490, 22);
            Controls.Add(status);

            uninstallButton = new Button();
            uninstallButton.Text = "Uninstall";
            uninstallButton.SetBounds(344, 258, 172, 38);
            uninstallButton.FlatStyle = FlatStyle.Flat;
            uninstallButton.FlatAppearance.BorderColor = Color.FromArgb(220, 80, 80);
            uninstallButton.BackColor = Color.FromArgb(220, 80, 80);
            uninstallButton.ForeColor = Color.White;
            uninstallButton.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            uninstallButton.Cursor = Cursors.Hand;
            uninstallButton.Click += delegate { DoUninstall(); };
            Controls.Add(uninstallButton);

            cancelButton = new Button();
            cancelButton.Text = "Cancel";
            cancelButton.SetBounds(242, 258, 92, 38);
            cancelButton.FlatStyle = FlatStyle.Flat;
            cancelButton.FlatAppearance.BorderColor = Color.FromArgb(45, 56, 70);
            cancelButton.BackColor = Color.FromArgb(17, 23, 31);
            cancelButton.ForeColor = Color.FromArgb(220, 230, 240);
            cancelButton.Cursor = Cursors.Hand;
            cancelButton.Click += delegate { Close(); };
            Controls.Add(cancelButton);

            AcceptButton = uninstallButton;
            CancelButton = cancelButton;
        }

        private void DoUninstall()
        {
            if (working)
            {
                return;
            }
            working = true;
            uninstallButton.Enabled = false;
            cancelButton.Enabled = false;
            removeData.Enabled = false;
            status.Text = "Removing FPV Rig...";

            try
            {
                string target = Path.GetDirectoryName(Application.ExecutablePath);
                InstallCommon.Uninstall(target, removeData.Checked);
                MessageBox.Show(this, "FPV Rig has been removed.", "Uninstall FPV Rig", MessageBoxButtons.OK, MessageBoxIcon.Information);
                Close();
            }
            catch (Exception ex)
            {
                working = false;
                uninstallButton.Enabled = true;
                cancelButton.Enabled = true;
                removeData.Enabled = true;
                status.Text = "Uninstall failed.";
                MessageBox.Show(this, "FPV Rig could not be removed:\r\n\r\n" + ex.Message, "Uninstall FPV Rig", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
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

            string target = Path.GetDirectoryName(Application.ExecutablePath);
            if (silent)
            {
                try
                {
                    InstallCommon.Uninstall(target, false);
                    return 0;
                }
                catch
                {
                    return 1;
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new UninstallForm());
            return 0;
        }
    }
}
