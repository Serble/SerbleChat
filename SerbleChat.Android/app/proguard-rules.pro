# kotlinx.serialization: keep the generated serializers of the API models and navigation routes.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers @kotlinx.serialization.Serializable class net.serble.chat.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class net.serble.chat.**$$serializer { *; }

# JNI entry points of the RNNoise bridge.
-keepclasseswithmembernames class net.serble.chat.voice.RnNoise { native <methods>; }

# OkHttp ships its own rules; these silence platform classes it probes for but never needs here.
-dontwarn org.bouncycastle.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**
