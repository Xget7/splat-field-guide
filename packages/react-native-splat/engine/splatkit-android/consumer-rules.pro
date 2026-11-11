# The native library binds SplatEngine's methods by their Java names
# (Java_com_splatkit_engine_SplatEngine_*) and calls onNativeEvent by name, so R8 must
# keep the class name and these members. -keepclassmembers alone would keep the members
# and still rename the class.
-keep class com.splatkit.engine.SplatEngine {
    private void onNativeEvent(int, java.lang.String, int);
    native <methods>;
}
