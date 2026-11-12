plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("com.vanniktech.maven.publish")
}

android {
    namespace = "com.splatkit"
    compileSdk = 36
    ndkVersion = "27.1.12297006"

    defaultConfig {
        minSdk = 29
        consumerProguardFiles("consumer-rules.pro")
        ndk { abiFilters += listOf("arm64-v8a") }
        externalNativeBuild {
            cmake {
                arguments += listOf(
                    "-DANDROID_STL=c++_static",
                    "-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON",
                )
                val sh8 = providers.gradleProperty("splatkitVulkanSh8").orElse("false").get()
                require(sh8 == "true" || sh8 == "false") { "splatkitVulkanSh8 must be true or false" }
                arguments += "-DSPLATKIT_VULKAN_SH8=${if (sh8 == "true") "ON" else "OFF"}"
                cppFlags += listOf("-std=c++17")
            }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}

// Maven Central. Credentials and the signing key come from the environment on the
// publishing machine (ORG_GRADLE_PROJECT_mavenCentralUsername, mavenCentralPassword,
// signingInMemoryKey, signingInMemoryKeyPassword); local builds need none of it.
mavenPublishing {
    coordinates("io.github.xget7", "splatkit-android", "0.1.0-beta.3")
    publishToMavenCentral(automaticRelease = true)
    if (project.findProperty("signingInMemoryKey") != null) signAllPublications()
    pom {
        name.set("SplatKit Android")
        description.set("Native Android Gaussian splatting SDK: Vulkan GPU visibility, radix sorting, hierarchical LOD, spherical harmonics, and walk navigation with colliders.")
        url.set("https://github.com/Xget7/splatkit")
        licenses {
            license {
                name.set("MIT")
                url.set("https://opensource.org/licenses/MIT")
            }
        }
        developers {
            developer {
                id.set("xget7")
                name.set("Juan Ignacio Andrade")
                email.set("juanieltupa@gmail.com")
                url.set("https://github.com/Xget7")
            }
        }
        scm {
            url.set("https://github.com/Xget7/splatkit")
            connection.set("scm:git:https://github.com/Xget7/splatkit.git")
            developerConnection.set("scm:git:ssh://git@github.com/Xget7/splatkit.git")
        }
    }
}
