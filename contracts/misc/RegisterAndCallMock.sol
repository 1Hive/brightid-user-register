pragma solidity ^0.4.24;

import "../RegisterAndCall.sol";

contract RegisterAndCallMock is RegisterAndCall {

    event ReceiveRegistration(address usersUniqueId, bytes data);

    function receiveRegistration(address _usersUniqueId, bytes _data) external {
        emit ReceiveRegistration(_usersUniqueId, _data);
    }
}
