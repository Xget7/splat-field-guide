require "json"
require_relative "scripts/engine-artifact"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "ReactNativeSplat"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/xget7/splat-field-guide"
  s.license      = "MIT"
  s.authors      = "Xget7"
  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/xget7/splat-field-guide.git", :tag => "#{s.version}" }

  engine = "ios/Frameworks/SplatKitCore.xcframework"
  EngineArtifact.verify!(__dir__)

  s.source_files        = ["ios/*.swift"]
  s.vendored_frameworks = engine
  # The engine's simulator slice is arm64 only, so simulator Release builds must skip x86_64.
  no_intel_simulator = { "EXCLUDED_ARCHS[sdk=iphonesimulator*]" => "x86_64" }
  s.pod_target_xcconfig  = no_intel_simulator
  s.user_target_xcconfig = no_intel_simulator
  s.frameworks          = ["Metal", "QuartzCore", "ARKit", "RealityKit", "AVFoundation"]
  s.libraries           = ["c++", "z"]

  load "nitrogen/generated/ios/ReactNativeSplat+autolinking.rb"
  add_nitrogen_files(s)

  install_modules_dependencies(s)
end
