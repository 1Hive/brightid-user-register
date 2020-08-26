pragma solidity ^0.4.24;

contract RegisterAndCall {

    /**
    * @dev This allows users to verify their BrightId account and interact with a contract in one transaction
    * @param _verifiedAddress Address of the account being verified
    * @param _data Optional data that can be used to add signalling information in more complex staking applications
    */
    function receiveRegistration(address _verifiedAddress, bytes _data) external;

}
