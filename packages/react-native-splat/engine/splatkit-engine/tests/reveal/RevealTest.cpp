#include "splatkit/reveal/Reveal.h"

#include <cmath>

#include <gtest/gtest.h>

namespace splatkit {
namespace {

constexpr float kStep = 1.0f / 60.0f;
constexpr float kSeconds = 1.4f;

splat::Bounds worldFrom(float bottom, float top) {
  splat::Bounds bounds;
  bounds.min = {0, bottom, 0};
  bounds.max = {1, top, 1};
  return bounds;
}

TEST(Reveal, DrawsEverySplatUntilStarted) {
  Reveal reveal;
  EXPECT_FALSE(reveal.active());
  EXPECT_FALSE(reveal.update(kStep));
  EXPECT_TRUE(std::isinf(reveal.level()));
  EXPECT_EQ(reveal.band(), 0.0f);
}

TEST(Reveal, RisesFromBelowTheWorldUntilEverySplatIsDrawn) {
  Reveal reveal;
  reveal.start(worldFrom(-1, 2), kSeconds);
  EXPECT_LT(reveal.level(), -1.0f);
  float previous = reveal.level();
  while (reveal.update(kStep)) {
    if (!reveal.active()) break;
    EXPECT_GE(reveal.level(), previous);
    previous = reveal.level();
  }
  EXPECT_FALSE(reveal.active());
  EXPECT_TRUE(std::isinf(reveal.level()));
  EXPECT_EQ(reveal.band(), 0.0f);
}

TEST(Reveal, ShowsAtOnceWithNoTimeOrNoHeight) {
  Reveal reveal;
  reveal.start(worldFrom(-1, 2), 0);
  EXPECT_FALSE(reveal.active());
  EXPECT_TRUE(std::isinf(reveal.level()));
  reveal.start(worldFrom(1, 1), kSeconds);
  EXPECT_FALSE(reveal.active());
  EXPECT_TRUE(std::isinf(reveal.level()));
}

}
}
