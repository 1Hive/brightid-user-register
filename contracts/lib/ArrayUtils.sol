pragma solidity ^0.4.24;

library ArrayUtils {

    address constant public UNVERIFIABLE_ADDRESS = address(-1);

    // Note that due to operating on a memory array, the array length can not be shortened
    // after an element is deleted so the element is set to an unverifiable address instead
    function deleteItem(address[] memory self, address item) internal returns (bool) {
        uint256 length = self.length;
        for (uint256 i = 0; i < length; i++) {
            if (self[i] == item) {
                uint256 newLength = self.length - 1;
                if (i != newLength) {
                    self[i] = self[newLength];
                }

                self[newLength] = UNVERIFIABLE_ADDRESS;

                return true;
            }
        }
        return false;
    }

    function contains(address[] memory self, address item) internal returns (bool) {
        for (uint256 i = 0; i < self.length; i++) {
            if (self[i] == item) {
                return true;
            }
        }
        return false;
    }
}
