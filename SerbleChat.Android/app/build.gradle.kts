plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

fun prop(name: String): String = providers.gradleProperty("serbleChat.$name").get()
fun quoted(value: String) = "\"$value\""

android {
    namespace = "net.serble.chat"
    compileSdk = 37
    ndkVersion = "27.1.12297006"

    defaultConfig {
        applicationId = "net.serble.chat"
        minSdk = 26
        targetSdk = 36
        versionCode = providers.gradleProperty("versionCode").map(String::toInt).getOrElse(1)
        versionName = providers.gradleProperty("versionName").getOrElse("1.0.0")

        // Serble's OAuth sends the browser back here after sign-in. Register exactly this as a
        // redirect url on the Serble app, beside the web one.
        buildConfigField("String", "OAUTH_REDIRECT", quoted("serblechat://auth/callback"))
        buildConfigField("String", "OAUTH_CLIENT_ID", quoted(prop("oauthClientId")))
        // Where Serble sends the browser after the user allows SerbleChat into Serble Files (only
        // asked when Serble needs consent). Also a redirect url to register on the Serble app.
        buildConfigField("String", "FILES_CONSENT_REDIRECT", quoted("serblechat://auth/files-callback"))

        externalNativeBuild { cmake { arguments += "-DANDROID_STL=none" } }
    }

    externalNativeBuild {
        cmake { path = file("src/main/cpp/CMakeLists.txt") }
    }

    signingConfigs {
        val keystore = providers.environmentVariable("SIGNING_KEYSTORE_FILE").orNull
        if (keystore != null) {
            create("release") {
                storeFile = file(keystore)
                storePassword = providers.environmentVariable("SIGNING_KEYSTORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("SIGNING_KEY_ALIAS").get()
                keyPassword = providers.environmentVariable("SIGNING_KEY_PASSWORD").get()
            }
        }
    }

    buildTypes {
        fun com.android.build.api.dsl.ApplicationBuildType.urls(debug: Boolean) {
            val p = if (debug) "debug" else ""
            fun key(name: String) = if (debug) p + name.replaceFirstChar(Char::uppercase) else name
            buildConfigField("String", "API_URL", quoted(prop(key("apiUrl"))))
            buildConfigField("String", "LIVEKIT_URL", quoted(prop(key("liveKitUrl"))))
            buildConfigField("String", "FRONTEND_URL", quoted(prop(key("frontendUrl"))))
            buildConfigField("String", "S3_URL", quoted(prop(key("s3Url"))))
            buildConfigField("String", "FILES_API_URL", quoted(prop(key("filesApiUrl"))))
            // Signing in with a backend test token: only builds that talk to a development backend
            buildConfigField("boolean", "DEV_SIGN_IN", debug.toString())
        }
        debug {
            applicationIdSuffix = ".debug"
            urls(debug = true)
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
            urls(debug = false)
        }
        // Release code (minified, optimised) against the development backend, installable beside
        // the other two. For judging how the app really feels: debug builds of Compose are slow.
        create("preview") {
            initWith(getByName("release"))
            applicationIdSuffix = ".preview"
            matchingFallbacks += "release"
            signingConfig = signingConfigs.getByName("debug")
            urls(debug = true)
        }
    }

    // One APK per processor type, plus a universal one: a phone downloads a third of the size, and
    // Obtainium picks the right file by name. (These replace ndk.abiFilters, which can't be set with them.)
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // No Google-encrypted dependency metadata in the APK.
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }

    packaging {
        resources.excludes += listOf("/META-INF/{AL2.0,LGPL2.1}", "DebugProbesKt.bin", "kotlin-tooling-metadata.json")
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.lifecycle.service)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.browser)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)

    implementation(libs.livekit.android)
    // The connector's Web Push decryption uses Tink. Plain Tink drags in full protobuf-java, which
    // clashes with LiveKit's protobuf-javalite; tink-android is the same code with protobuf shaded.
    implementation(libs.unifiedpush.connector) { exclude(group = "com.google.crypto.tink", module = "tink") }
    implementation(libs.tink.android)
    // Falls back to Google's push service (through Play Services) when no UnifiedPush distributor
    // is installed. Contains no Google code; the backend's VAPID-signed Web Push goes to FCM as is.
    implementation(libs.unifiedpush.fcm)

    testImplementation(libs.junit)
}
