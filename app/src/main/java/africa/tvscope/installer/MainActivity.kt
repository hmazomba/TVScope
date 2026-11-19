package africa.tvscope.installer

import android.app.Activity
import android.content.Intent
import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkAddress
import java.net.Inet4Address
import java.net.InetAddress
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger
import android.hardware.usb.UsbManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.*
import java.net.InetSocketAddress
import java.net.Socket
import kotlin.concurrent.thread

class MainActivity : Activity() {
    private lateinit var output: TextView
    private lateinit var host: EditText
    private lateinit var port: EditText
    private val main = Handler(Looper.getMainLooper())
    private val report = StringBuilder("TVScope diagnostics\n")
    private val ports = listOf(5555, 37099, 37100)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
        }
        val title = TextView(this).apply { text = "TVScope — JVC Fallback Diagnostics"; textSize = 21f }
        val subtitle = TextView(this).apply {
            text = "For JVC TV with inaccessible Developer Options. Tests do not bypass TV security."
        }
        host = EditText(this).apply { hint = "TV IP address (same LAN)"; setSingleLine(true) }
        port = EditText(this).apply { hint = "Custom TCP port"; setText("5555"); inputType = 2 }
        val usb = Button(this).apply { text = "Inspect USB ADB interface"; setOnClickListener { inspectUsb() } }
        val discover = Button(this).apply { text = "Discover LAN devices (no TV IP needed)"; setOnClickListener { discoverLan() } }
        val tcp = Button(this).apply { text = "Probe known TV IP ports"; setOnClickListener { probeNetwork() } }
        val manual = Button(this).apply { text = "USB APK install fallback guide"; setOnClickListener { showGuide() } }
        val share = Button(this).apply { text = "Share diagnostics report"; setOnClickListener { shareReport() } }
        output = TextView(this).apply {
            text = "No tests run. TV-side Developer Options remain unverified.\n\n" +
                "Connect phone to TV via USB OTG for USB test; both devices on same LAN for network test."
            textSize = 14f
        }
        layout.addView(title)
        layout.addView(subtitle)
        layout.addView(host)
        layout.addView(port)
        layout.addView(usb)
        layout.addView(discover)
        layout.addView(tcp)
        layout.addView(manual)
        layout.addView(share)
        val scroll = ScrollView(this).apply { addView(output) }
        layout.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(layout)
    }

    private fun show(message: String) {
        main.post {
            output.text = message
            report.append("\n").append(message).append("\n")
        }
    }

    private fun inspectUsb() {
        val manager = getSystemService(USB_SERVICE) as UsbManager
        val devices = manager.deviceList.values
        if (devices.isEmpty()) {
            show("No USB devices detected. Check phone OTG host support, cable, TV USB role. " +
                "TV USB ports may be host-only; host-to-host cable cannot establish ADB. Test phone OTG with USB flash drive first.")
            return
        }
        val lines = mutableListOf<String>()
        var candidates = 0
        for (device in devices) {
            lines.add("USB vendor=${device.vendorId}, product=${device.productId}, interfaces=${device.interfaceCount}")
            for (i in 0 until device.interfaceCount) {
                val iface = device.getInterface(i)
                val adb = iface.interfaceClass == 255 &&
                    iface.interfaceSubclass == 66 && iface.interfaceProtocol == 1
                if (adb) candidates++
                lines.add("  interface $i class=${iface.interfaceClass} " +
                    "subclass=${iface.interfaceSubclass} protocol=${iface.interfaceProtocol} " +
                    "endpoints=${iface.endpointCount} ADB=${if (adb) "POSSIBLE" else "NO"}")
            }
        }
        lines.add("ADB interface candidates: $candidates")
        lines.add("Interface detection does not prove debugging enabled, authorization, or install capability.")
        show(lines.joinToString("\n"))
    }

    private fun discoverLan() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork
        val properties = network?.let { cm.getLinkProperties(it) }
        val ipv4 = properties?.linkAddresses?.firstOrNull {
            it.address is Inet4Address && !it.address.isLoopbackAddress
        }
        if (ipv4 == null) {
            show("No active IPv4 LAN address. Connect phone to same Wi-Fi as TV. Disable VPN/mobile data if routing differs.")
            return
        }
        val address = ipv4.address.address
        val prefix = ipv4.prefixLength
        if (prefix !in 16..30) {
            show("Unsupported subnet prefix /$prefix. Automatic scan limited to local /24. Use router DHCP client list.")
            return
        }
        // Limit scanning to 254 hosts on phone's local /24; do not scan internet or unrelated subnets.
        val base = (address[0].toInt() and 255).toString() + "." +
            (address[1].toInt() and 255) + "." + (address[2].toInt() and 255) + "."
        val own = address[3].toInt() and 255
        show("Scanning $base" + "0/24 (ports 80, 443, 5555). TV may not expose any open ports.\n" +
            "MAC matching unavailable on many modern Android phones; compare router DHCP leases.")
        thread {
            val pool = Executors.newFixedThreadPool(24)
            val found = ConcurrentLinkedQueue<String>()
            val done = AtomicInteger(0)
            for (i in 1..254) {
                if (i == own) continue
                pool.execute {
                    val ip = "$base$i"
                    val open = listOf(80, 443, 5555).filter { number ->
                        try {
                            Socket().use { it.connect(InetSocketAddress(ip, number), 300) }
                            true
                        } catch (_: Exception) { false }
                    }
                    if (open.isNotEmpty()) found.add("$ip open ports: ${open.joinToString(", ")}")
                    val count = done.incrementAndGet()
                    if (count % 64 == 0) main.post { output.text = "LAN scan: $count/253 checked..." }
                }
            }
            pool.shutdown()
            val finished = pool.awaitTermination(90, TimeUnit.SECONDS)
            if (!finished) pool.shutdownNow()
            val results = found.toList().sortedWith(compareBy { it.substringBefore(" ").substringAfterLast(".").toIntOrNull() ?: 0 })
            show("LAN discovery ${if (finished) "complete" else "timed out"}.\n" +
                (if (results.isEmpty()) "No hosts with tested ports open. TV can still be online." else results.joinToString("\n")) +
                "\nCannot identify JVC by IP alone. Compare MAC with router client list. " +
                "ADB requires TV-side authorization; open port 5555 does not prove ADB.")
        }
    }

    private fun probeNetwork() {
        val address = host.text.toString().trim()
        val custom = port.text.toString().toIntOrNull()
        if (address.isEmpty() || address.any { it.isWhitespace() } ||
            custom == null || custom !in 1..65535) {
            show("Enter valid TV IP/hostname and port 1–65535.")
            return
        }
        val targets = (listOf(custom) + ports).distinct()
        show("Probing $address on ports ${targets.joinToString(", ")} ...")
        thread {
            val lines = mutableListOf<String>()
            for (number in targets) {
                val result = try {
                    Socket().use { socket ->
                        socket.connect(InetSocketAddress(address, number), 1800)
                        "OPEN (TCP reachable; service/ADB auth unknown)"
                    }
                } catch (e: Exception) {
                    "UNREACHABLE (${e.javaClass.simpleName})"
                }
                lines.add("$address:$number — $result")
            }
            lines.add("Ports 37099/37100 are examples, not guaranteed Android wireless-debugging ports.")
            lines.add("Closed ports cannot prove Developer Options disabled. No pairing/authentication attempted.")
            show(lines.joinToString("\n"))
        }
    }

    private fun showGuide() {
        show(
            "TV-SIDE APK FALLBACK (manual, no ADB):\n" +
            "1. Copy trusted, TV-compatible APK to FAT32 USB flash drive using PC.\n" +
            "2. Plug flash drive into JVC TV USB port (NOT phone-to-TV USB cable).\n" +
            "3. Open TV file manager or built-in media browser. Check whether APK is visible.\n" +
            "4. Select APK. If Android Package Installer appears, follow TV permission prompt.\n" +
            "5. If blocked, check TV Settings > Apps > Special app access > Install unknown apps " +
            "(menu may be absent). Grant only to trusted file manager if TV permits.\n" +
            "6. If file manager cannot open APK or installer is blocked, stop. " +
            "Try manufacturer-supported app store or JVC support.\n" +
            "No silent install, security bypass, root, or firmware flashing.\n" +
            "PHONE SETTINGS DO NOT CHANGE TV SETTINGS."
        )
    }

    private fun shareReport() {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, "TVScope diagnostic report")
            putExtra(Intent.EXTRA_TEXT, report.toString())
        }
        startActivity(Intent.createChooser(intent, "Share TVScope report"))
    }
}
