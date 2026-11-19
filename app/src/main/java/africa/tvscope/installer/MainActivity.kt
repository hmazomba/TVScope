package africa.tvscope.installer

import android.app.Activity
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
        }
        val title = TextView(this).apply { text = "TVScope — Connection Diagnostics"; textSize = 21f }
        host = EditText(this).apply { hint = "TV IP address"; setSingleLine(true) }
        port = EditText(this).apply { hint = "ADB TCP port"; setText("5555"); inputType = 2 }
        val usb = Button(this).apply { text = "Inspect USB devices"; setOnClickListener { inspectUsb() } }
        val tcp = Button(this).apply { text = "Test TCP reachability"; setOnClickListener { testTcp() } }
        output = TextView(this).apply { text = "No tests run. USB detection and TCP probe only; ADB auth/install not implemented."; textSize = 14f }
        layout.addView(title); layout.addView(host); layout.addView(port)
        layout.addView(usb); layout.addView(tcp)
        val scroll = ScrollView(this).apply { addView(output) }
        layout.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(layout)
    }

    private fun show(message: String) { main.post { output.text = message } }

    private fun inspectUsb() {
        val manager = getSystemService(USB_SERVICE) as UsbManager
        val devices = manager.deviceList.values
        if (devices.isEmpty()) { show("No USB devices detected. Check OTG host support, cable and device role."); return }
        val lines = mutableListOf<String>()
        for (device in devices) {
            lines.add("USB vendor=${device.vendorId}, product=${device.productId}, interfaces=${device.interfaceCount}")
            for (i in 0 until device.interfaceCount) {
                val iface = device.getInterface(i)
                val adb = iface.interfaceClass == 255 && iface.interfaceSubclass == 66 && iface.interfaceProtocol == 1
                lines.add("  interface $i class=${iface.interfaceClass} subclass=${iface.interfaceSubclass} protocol=${iface.interfaceProtocol} endpoints=${iface.endpointCount} ADB=${if (adb) "POSSIBLE" else "NO"}")
            }
        }
        lines.add("Detection does not prove USB debugging or ADB authorization.")
        show(lines.joinToString("\n"))
    }

    private fun testTcp() {
        val address = host.text.toString().trim()
        val number = port.text.toString().toIntOrNull()
        if (address.isEmpty() || number == null || number !in 1..65535) {
            show("Enter valid IP/hostname and TCP port."); return
        }
        show("Connecting to $address:$number ...")
        thread {
            val result = try {
                Socket().use { socket ->
                    socket.connect(InetSocketAddress(address, number), 3000)
                    "TCP reachable: $address:$number. This does NOT confirm ADB service or authorization."
                }
            } catch (e: Exception) { "TCP failed: ${e.javaClass.simpleName}: ${e.message}" }
            show(result)
        }
    }
}
