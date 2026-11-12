#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(CourseDocuments, NSObject)
RCT_EXTERN_METHOD(list:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(open:(NSString *)identifier resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
