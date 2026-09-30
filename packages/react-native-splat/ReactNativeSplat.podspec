require "json"

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
  unless File.exist?(File.join(__dir__, engine))
    raise "#{s.name}: #{engine} is missing; build it with scripts/build-ios-engine.sh, then run pod install again"
  end

  s.source_files        = ["ios/*.swift"]
  s.vendored_frameworks = engine
  s.frameworks          = ["Metal", "QuartzCore"]
  s.libraries           = ["c++", "z"]

  load "nitrogen/generated/ios/ReactNativeSplat+autolinking.rb"
  add_nitrogen_files(s)

  install_modules_dependencies(s)
end
