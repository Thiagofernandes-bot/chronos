// Chronos probe: imprime uma linha JSON por tick com a janela ativa, o tempo
// ocioso e, em navegadores, a URL da aba atual (lida via UI Automation).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Automation;

static class Probe
{
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
    [DllImport("kernel32.dll")] static extern uint GetTickCount();
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr hWnd, EnumWindowsProc cb, IntPtr lp);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder name, int count);

    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }

    static readonly HashSet<string> Browsers = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    { "chrome", "msedge", "brave", "firefox", "opera", "opera_gx", "vivaldi", "chromium", "iexplore", "arc" };

    // Valor da omnibox: "dominio.com/..." ou "https://...". Evita capturar
    // campos de busca de PWAs, que nao se parecem com URL.
    static readonly Regex UrlLike = new Regex(
        @"^(https?://|about:|file:///|[a-z0-9][a-z0-9\-]*(\.[a-z0-9\-]+)+(:\d+)?(/|\?|$))",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    static readonly Dictionary<int, string[]> AppInfoCache = new Dictionary<int, string[]>();
    static string lastUrlKey = "";
    static string lastUrl = null;

    static int Main(string[] args)
    {
        int interval = 2000, parentPid = 0;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--interval" && i + 1 < args.Length) int.TryParse(args[i + 1], out interval);
            if (args[i] == "--parent" && i + 1 < args.Length) int.TryParse(args[i + 1], out parentPid);
        }
        if (interval < 500) interval = 500;

        var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        stdout.AutoFlush = true;

        Process parent = null;
        if (parentPid > 0) { try { parent = Process.GetProcessById(parentPid); } catch { } }

        while (true)
        {
            if (parent != null && parent.HasExited) return 0;
            try { stdout.WriteLine(Sample()); }
            catch (IOException) { return 0; }
            catch (Exception ex)
            {
                try { stdout.WriteLine("{\"error\":" + Json(ex.Message) + "}"); } catch { return 0; }
            }
            System.Threading.Thread.Sleep(interval);
        }
    }

    static string Sample()
    {
        long ts = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        int idle = IdleSeconds();
        IntPtr hwnd = GetForegroundWindow();

        var sb = new StringBuilder();
        sb.Append("{\"ts\":").Append(ts).Append(",\"idle\":").Append(idle);

        var midia = MidiaTocando();
        if (midia != null)
        {
            sb.Append(",\"midia\":{\"app\":").Append(Json(midia[0]))
              .Append(",\"titulo\":").Append(Json(midia[1]))
              .Append(",\"artista\":").Append(Json(midia[2])).Append("}");
        }

        if (hwnd == IntPtr.Zero)
        {
            sb.Append(",\"exe\":null}");
            return sb.ToString();
        }

        uint pid; GetWindowThreadProcessId(hwnd, out pid);
        string title = WindowTitle(hwnd);
        string exe = ProcessName((int)pid);

        // Apps da Store rodam dentro do ApplicationFrameHost: o processo real
        // esta em uma janela filha.
        if (string.Equals(exe, "ApplicationFrameHost", StringComparison.OrdinalIgnoreCase))
        {
            uint real = RealUwpPid(hwnd, pid);
            if (real != 0 && real != pid) { pid = real; exe = ProcessName((int)pid); }
        }

        string[] info = AppInfo((int)pid, exe);
        string url = Browsers.Contains(exe) ? BrowserUrl(hwnd, title) : null;

        sb.Append(",\"pid\":").Append(pid)
          .Append(",\"exe\":").Append(Json(exe))
          .Append(",\"app\":").Append(Json(info[0]))
          .Append(",\"path\":").Append(Json(info[1]))
          .Append(",\"title\":").Append(Json(title))
          .Append(",\"url\":").Append(Json(url))
          .Append("}");
        return sb.ToString();
    }

    static int IdleSeconds()
    {
        var lii = new LASTINPUTINFO();
        lii.cbSize = (uint)Marshal.SizeOf(lii);
        if (!GetLastInputInfo(ref lii)) return 0;
        long ms = (long)(uint)(GetTickCount() - lii.dwTime);
        return (int)(ms / 1000);
    }

    static string WindowTitle(IntPtr hwnd)
    {
        int len = GetWindowTextLength(hwnd);
        if (len <= 0) return "";
        var sb = new StringBuilder(len + 2);
        GetWindowText(hwnd, sb, sb.Capacity);
        return sb.ToString();
    }

    static uint RealUwpPid(IntPtr hwnd, uint hostPid)
    {
        uint found = 0;
        EnumChildWindows(hwnd, delegate(IntPtr child, IntPtr lp)
        {
            var cls = new StringBuilder(256);
            GetClassName(child, cls, cls.Capacity);
            if (cls.ToString() == "Windows.UI.Core.CoreWindow")
            {
                uint cpid; GetWindowThreadProcessId(child, out cpid);
                if (cpid != hostPid) { found = cpid; return false; }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    static string ProcessName(int pid)
    {
        try { return Process.GetProcessById(pid).ProcessName; } catch { return "?"; }
    }

    // Devolve [nome amigavel, caminho do executavel].
    static string[] AppInfo(int pid, string exe)
    {
        string[] cached;
        if (AppInfoCache.TryGetValue(pid, out cached)) return cached;

        string name = exe;
        string path = null;
        try
        {
            path = Process.GetProcessById(pid).MainModule.FileName;
            var info = FileVersionInfo.GetVersionInfo(path);
            string desc = (info.FileDescription ?? "").Trim();
            string prod = (info.ProductName ?? "").Trim();

            // Alguns apps poem um identificador no lugar do nome
            // ("WhatsApp.Root"): nesse caso o ProductName costuma ser melhor.
            bool descIsId = desc.Length > 0 && desc.IndexOf(' ') < 0 && desc.IndexOf('.') >= 0;
            if (desc.Length > 0 && !descIsId) name = desc;
            else if (prod.Length > 0) name = prod;
            else if (desc.Length > 0) name = desc;
        }
        catch { }

        name = CleanName(name);
        var pair = new string[] { name, path };
        if (AppInfoCache.Count > 400) AppInfoCache.Clear();
        AppInfoCache[pid] = pair;
        return pair;
    }

    static string CleanName(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return "?";
        string n = name.Trim();
        if (n.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) n = n.Substring(0, n.Length - 4);
        n = Regex.Replace(n, @"\.(Root|App|Desktop|Client)$", "", RegexOptions.IgnoreCase);
        n = Regex.Replace(n, @"\s*\((32|64)[- ]?bit\)$", "", RegexOptions.IgnoreCase);
        return n.Trim();
    }

    // UIA pode travar; roda em outra thread com timeout curto para nao
    // interromper o loop de amostragem.
    static string BrowserUrl(IntPtr hwnd, string title)
    {
        string key = hwnd.ToInt64() + "|" + title;
        if (key == lastUrlKey) return lastUrl;

        string url = null;
        try
        {
            var task = Task.Factory.StartNew(delegate { return ReadOmnibox(hwnd); });
            url = task.Wait(900) ? task.Result : lastUrl;
        }
        catch { }

        lastUrlKey = key;
        lastUrl = url;
        return url;
    }

    static string ReadOmnibox(IntPtr hwnd)
    {
        try
        {
            var win = AutomationElement.FromHandle(hwnd);
            if (win == null) return null;
            var cond = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit);
            var edits = win.FindAll(TreeScope.Descendants, cond);
            foreach (AutomationElement e in edits)
            {
                object pattern;
                if (!e.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) continue;
                string v = ((ValuePattern)pattern).Current.Value;
                if (string.IsNullOrWhiteSpace(v)) continue;
                v = v.Trim();
                if (UrlLike.IsMatch(v)) return v;
            }
        }
        catch { }
        return null;
    }

    // ----------------------------------------------------------- midia
    // O Windows mantem uma sessao de midia para quem esta tocando (os botoes
    // de midia do teclado falam com ela). De la sai o app, o titulo e o
    // "artista" - que no YouTube e o nome do canal - mesmo com a janela
    // atras de outra. E assim que o tempo de video na tela secundaria conta.
    //
    // As APIs sao WinRT: no .NET Framework elas so chegam por reflexao.
    static object gerenciadorMidia = null;
    static bool midiaIndisponivel = false;
    static MethodInfo asTaskGenerico = null;

    static Type TipoWinRT(string nome, string assembly)
    {
        try { return Type.GetType(nome + ", " + assembly + ", ContentType=WindowsRuntime"); }
        catch { return null; }
    }

    static object EsperarWinRT(object operacao, Type tipoResultado)
    {
        if (operacao == null || tipoResultado == null) return null;
        try
        {
            if (asTaskGenerico == null)
            {
                foreach (var m in typeof(System.WindowsRuntimeSystemExtensions).GetMethods())
                {
                    if (m.Name != "AsTask") continue;
                    var ps = m.GetParameters();
                    if (ps.Length == 1 && ps[0].ParameterType.Name == "IAsyncOperation`1")
                    { asTaskGenerico = m; break; }
                }
            }
            if (asTaskGenerico == null) return null;

            var tarefa = (Task)asTaskGenerico.MakeGenericMethod(tipoResultado)
                .Invoke(null, new object[] { operacao });
            if (!tarefa.Wait(1500)) return null;
            return tarefa.GetType().GetProperty("Result").GetValue(tarefa, null);
        }
        catch { return null; }
    }

    static void PrepararMidia()
    {
        var tipo = TipoWinRT("Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager",
            "Windows.Media.Control");
        if (tipo == null) { midiaIndisponivel = true; return; }
        try
        {
            var pedido = tipo.GetMethod("RequestAsync", BindingFlags.Public | BindingFlags.Static)
                .Invoke(null, null);
            gerenciadorMidia = EsperarWinRT(pedido, tipo);
        }
        catch { gerenciadorMidia = null; }
        if (gerenciadorMidia == null) midiaIndisponivel = true;
    }

    // Devolve {app, titulo, artista} de quem esta tocando agora, ou null.
    static string[] MidiaTocando()
    {
        if (midiaIndisponivel) return null;
        if (gerenciadorMidia == null) PrepararMidia();
        if (gerenciadorMidia == null) return null;

        try
        {
            dynamic gerenciador = gerenciadorMidia;
            var sessoes = gerenciador.GetSessions();
            foreach (dynamic sessao in sessoes)
            {
                var estado = sessao.GetPlaybackInfo();
                if (estado == null) continue;
                if (estado.PlaybackStatus.ToString() != "Playing") continue;

                string origem = "";
                try { origem = (string)sessao.SourceAppUserModelId; } catch { }

                string titulo = "", artista = "";
                var tipoProps = TipoWinRT(
                    "Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties",
                    "Windows.Media.Control");
                object props = EsperarWinRT(sessao.TryGetMediaPropertiesAsync(), tipoProps);
                if (props != null)
                {
                    dynamic p = props;
                    try { titulo = (string)p.Title; } catch { }
                    try { artista = (string)p.Artist; } catch { }
                }

                return new string[] { origem ?? "", titulo ?? "", artista ?? "" };
            }
        }
        catch { /* uma sessao de midia problematica nao derruba o loop */ }
        return null;
    }

    static string Json(string s)
    {
        if (s == null) return "null";
        var sb = new StringBuilder("\"");
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20 || c == 0x7f) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.Append("\"").ToString();
    }
}
