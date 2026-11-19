package africa.tvscope.installer

import android.app.Activity
import android.content.Intent
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
        val tcp = Button(this).apply { text = "Probe TV network ports"; setOnClickListener { probeNetwork() } }
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
                "TV USB ports may be host-only; host-to-host cable cannot establish ADB.")
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
