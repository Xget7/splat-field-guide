#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Each utterance owns a run configuration that can be cancelled during Session::Run.
@interface KokoroCancellation : NSObject
@property (nonatomic, readonly) BOOL isCancelled;
- (void)cancel;
@end

@interface KokoroNative : NSObject
- (nullable instancetype)initWithModelPath:(NSString *)path
                                    error:(NSError **)error;
- (nullable NSData *)synthesizeTokens:(NSArray<NSNumber *> *)tokens
                               style:(NSData *)style
                        cancellation:(KokoroCancellation *)cancellation
                               error:(NSError **)error;
@end

NS_ASSUME_NONNULL_END
