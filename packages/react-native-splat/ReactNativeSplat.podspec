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

  s.source_files = ["ios/**/*.{swift,h,m,mm}"]
  s.frameworks   = ["Metal", "QuartzCore"]

  load "nitrogen/generated/ios/ReactNativeSplat+autolinking.rb"
  add_nitrogen_files(s)

  install_modules_dependencies(s)
end
