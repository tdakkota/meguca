package db

// TODO

// func TestBanUnban(t *testing.T) {
// 	prepareForModeration(t)

// 	err := Ban("all", "test", "admin", time.Minute, 1)
// 	if err != nil {
// 		t.Fatal(err)
// 	}
// 	err = RefreshBanCache()
// 	if err != nil {
// 		t.Fatal(err)
// 	}

// 	for _, board := range [...]string{"a", "all"} {
// 		err = IsBanned(board, net.ParseIP("::1"))
// 		test.AssertEquals(t, err, common.ErrBanned)
// 	}
// 	err = Unban("a", 1, "admin")
// 	if err != nil {
// 		t.Fatal(err)
// 	}
// }
