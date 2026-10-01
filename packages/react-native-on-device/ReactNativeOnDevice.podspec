require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "ReactNativeOnDevice"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/xget7/splat-field-guide"
  s.license      = "MIT"
  s.authors      = "Xget7"
  s.platforms    = { :ios => "26.0" }
  s.source       = { :git => "https://github.com/xget7/splat-field-guide.git", :tag => "#{s.version}" }

  s.source_files = ["ios/*.swift"]
  s.frameworks = ["Speech", "AVFoundation", "FoundationModels", "Accelerate"]

  load "nitrogen/generated/ios/ReactNativeOnDevice+autolinking.rb"
  add_nitrogen_files(s)

  install_modules_dependencies(s)
end
