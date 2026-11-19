plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
 namespace = "africa.tvscope.installer"
 compileSdk = 35
 defaultConfig { applicationId = "africa.tvscope.installer"; minSdk = 24; targetSdk = 32; versionCode = 2; versionName = "0.2.0" }
 buildTypes { release { isMinifyEnabled = false } }
 compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
 kotlinOptions { jvmTarget = "17" }
}
