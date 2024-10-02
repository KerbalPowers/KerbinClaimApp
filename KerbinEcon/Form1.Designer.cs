namespace KerbinEcon
{
    partial class Form1
    {
        /// <summary>
        ///  Required designer variable.
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary>
        ///  Clean up any resources being used.
        /// </summary>
        /// <param name="disposing">true if managed resources should be disposed; otherwise, false.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Windows Form Designer generated code

        /// <summary>
        ///  Required method for Designer support - do not modify
        ///  the contents of this method with the code editor.
        /// </summary>
        private void InitializeComponent()
        {
            button1 = new Button();
            menuStrip1 = new MenuStrip();
            nationalSummaryToolStripMenuItem = new ToolStripMenuItem();
            economyToolStripMenuItem = new ToolStripMenuItem();
            industryToolStripMenuItem = new ToolStripMenuItem();
            facilitiesToolStripMenuItem = new ToolStripMenuItem();
            tradeToolStripMenuItem = new ToolStripMenuItem();
            populationToolStripMenuItem = new ToolStripMenuItem();
            assetsToolStripMenuItem = new ToolStripMenuItem();
            stockpilesToolStripMenuItem = new ToolStripMenuItem();
            unitsToolStripMenuItem = new ToolStripMenuItem();
            menuStrip1.SuspendLayout();
            SuspendLayout();
            // 
            // button1
            // 
            button1.AccessibleName = "yeye";
            button1.Location = new Point(12, 86);
            button1.Name = "button1";
            button1.Size = new Size(119, 37);
            button1.TabIndex = 0;
            button1.Text = "button1";
            button1.UseVisualStyleBackColor = true;
            button1.Click += button1_Click;
            // 
            // menuStrip1
            // 
            menuStrip1.Items.AddRange(new ToolStripItem[] { nationalSummaryToolStripMenuItem, economyToolStripMenuItem, populationToolStripMenuItem, assetsToolStripMenuItem });
            menuStrip1.Location = new Point(0, 0);
            menuStrip1.Name = "menuStrip1";
            menuStrip1.Size = new Size(996, 24);
            menuStrip1.TabIndex = 1;
            menuStrip1.Text = "menuStrip1";
            // 
            // nationalSummaryToolStripMenuItem
            // 
            nationalSummaryToolStripMenuItem.Name = "nationalSummaryToolStripMenuItem";
            nationalSummaryToolStripMenuItem.Size = new Size(118, 20);
            nationalSummaryToolStripMenuItem.Text = "National Summary";
            // 
            // economyToolStripMenuItem
            // 
            economyToolStripMenuItem.DropDownItems.AddRange(new ToolStripItem[] { industryToolStripMenuItem, facilitiesToolStripMenuItem, tradeToolStripMenuItem });
            economyToolStripMenuItem.Name = "economyToolStripMenuItem";
            economyToolStripMenuItem.Size = new Size(69, 20);
            economyToolStripMenuItem.Text = "Economy";
            // 
            // industryToolStripMenuItem
            // 
            industryToolStripMenuItem.Name = "industryToolStripMenuItem";
            industryToolStripMenuItem.Size = new Size(180, 22);
            industryToolStripMenuItem.Text = "Industry";
            // 
            // facilitiesToolStripMenuItem
            // 
            facilitiesToolStripMenuItem.Name = "facilitiesToolStripMenuItem";
            facilitiesToolStripMenuItem.Size = new Size(180, 22);
            facilitiesToolStripMenuItem.Text = "Facilities";
            // 
            // tradeToolStripMenuItem
            // 
            tradeToolStripMenuItem.Name = "tradeToolStripMenuItem";
            tradeToolStripMenuItem.Size = new Size(180, 22);
            tradeToolStripMenuItem.Text = "Trade";
            // 
            // populationToolStripMenuItem
            // 
            populationToolStripMenuItem.Name = "populationToolStripMenuItem";
            populationToolStripMenuItem.Size = new Size(77, 20);
            populationToolStripMenuItem.Text = "Population";
            // 
            // assetsToolStripMenuItem
            // 
            assetsToolStripMenuItem.DropDownItems.AddRange(new ToolStripItem[] { stockpilesToolStripMenuItem, unitsToolStripMenuItem });
            assetsToolStripMenuItem.Name = "assetsToolStripMenuItem";
            assetsToolStripMenuItem.Size = new Size(52, 20);
            assetsToolStripMenuItem.Text = "Assets";
            // 
            // stockpilesToolStripMenuItem
            // 
            stockpilesToolStripMenuItem.Name = "stockpilesToolStripMenuItem";
            stockpilesToolStripMenuItem.Size = new Size(180, 22);
            stockpilesToolStripMenuItem.Text = "Stockpiles";
            // 
            // unitsToolStripMenuItem
            // 
            unitsToolStripMenuItem.Name = "unitsToolStripMenuItem";
            unitsToolStripMenuItem.Size = new Size(180, 22);
            unitsToolStripMenuItem.Text = "Units";
            // 
            // Form1
            // 
            AutoScaleDimensions = new SizeF(7F, 15F);
            AutoScaleMode = AutoScaleMode.Font;
            ClientSize = new Size(996, 606);
            Controls.Add(button1);
            Controls.Add(menuStrip1);
            MainMenuStrip = menuStrip1;
            Name = "Form1";
            Text = "Form1";
            Load += Form1_Load;
            menuStrip1.ResumeLayout(false);
            menuStrip1.PerformLayout();
            ResumeLayout(false);
            PerformLayout();
        }

        #endregion

        private Button button1;
        private MenuStrip menuStrip1;
        private ToolStripMenuItem nationalSummaryToolStripMenuItem;
        private ToolStripMenuItem economyToolStripMenuItem;
        private ToolStripMenuItem industryToolStripMenuItem;
        private ToolStripMenuItem facilitiesToolStripMenuItem;
        private ToolStripMenuItem tradeToolStripMenuItem;
        private ToolStripMenuItem populationToolStripMenuItem;
        private ToolStripMenuItem assetsToolStripMenuItem;
        private ToolStripMenuItem stockpilesToolStripMenuItem;
        private ToolStripMenuItem unitsToolStripMenuItem;
    }
}
